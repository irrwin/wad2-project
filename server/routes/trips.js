import express from 'express'
import mongoose from 'mongoose'
import Trip from '../models/trip.js'
import User from '../models/User.js'
import { requireAuth } from './auth.js'

const router = express.Router()
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PACE_LEVELS = ['relaxed', 'balanced', 'packed']
const BUDGET_LEVELS = ['budget', 'midrange', 'luxury']

function uniqueTravellers(travellers = []) {
  const seen = new Set()
  return travellers.filter((name) => {
    const key = String(name).trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function quorumFor(trip) {
  return Math.floor(uniqueTravellers(trip.travellers).length / 2) + 1
}

function compatibilityFor(trip) {
  const travellers = uniqueTravellers(trip.travellers)
  const profiles = trip.memberPreferences || []
  const completed = travellers.map((traveller) => {
    const profile = profiles.find((p) => String(p.traveller).toLowerCase() === traveller.toLowerCase())
    return profile ? { traveller, pace: profile.pace, budget: profile.budget } : { traveller, pace: '', budget: '' }
  })
  const ready = completed.filter((p) => PACE_LEVELS.includes(p.pace) && BUDGET_LEVELS.includes(p.budget))
  const issues = []

  if (ready.length > 1) {
    const paceValues = ready.map((p) => PACE_LEVELS.indexOf(p.pace))
    const budgetValues = ready.map((p) => BUDGET_LEVELS.indexOf(p.budget))
    const paceGap = Math.max(...paceValues) - Math.min(...paceValues)
    const budgetGap = Math.max(...budgetValues) - Math.min(...budgetValues)
    if (paceGap >= 2) issues.push({ field: 'pace', level: 'high', message: 'The group mixes relaxed and packed travel styles.' })
    else if (paceGap === 1) issues.push({ field: 'pace', level: 'medium', message: 'Some travellers prefer a different daily pace.' })
    if (budgetGap >= 2) issues.push({ field: 'budget', level: 'high', message: 'The group mixes backpacker and luxury budgets.' })
    else if (budgetGap === 1) issues.push({ field: 'budget', level: 'medium', message: 'The group should agree on a spending range.' })
  }

  const missing = completed.filter((p) => !p.pace || !p.budget).map((p) => p.traveller)
  const status = issues.some((i) => i.level === 'high') ? 'mismatch' : missing.length ? 'incomplete' : issues.length ? 'review' : 'aligned'
  return { status, missing, issues, profiles: completed }
}

function decisionState(trip) {
  return {
    candidates: trip.decisions || [],
    travellers: uniqueTravellers(trip.travellers),
    quorum: quorumFor(trip),
    compatibility: compatibilityFor(trip)
  }
}

function cleanCandidate(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const proposedDate = typeof body.proposedDate === 'string' ? body.proposedDate : ''
  const proposedHour = Number(body.proposedHour)
  const duration = Number(body.duration || 2)
  if (!name || name.length > 120 || !DATE_PATTERN.test(proposedDate)) return null
  if (!Number.isInteger(proposedHour) || proposedHour < 0 || proposedHour > 23) return null
  if (!Number.isFinite(duration) || duration <= 0 || duration > 12) return null
  const safeUrl = typeof body.url === 'string' && /^https?:\/\//.test(body.url) ? body.url.slice(0, 500) : ''
  return {
    id: new mongoose.Types.ObjectId().toString(),
    name,
    address: typeof body.address === 'string' ? body.address.trim().slice(0, 200) : '',
    category: typeof body.category === 'string' ? body.category.trim().slice(0, 60) : 'Activity',
    source: ['google', 'ticketmaster', 'manual'].includes(body.source) ? body.source : 'manual',
    externalId: typeof body.externalId === 'string' ? body.externalId.slice(0, 160) : '',
    url: safeUrl,
    rating: Number.isFinite(Number(body.rating)) ? Number(body.rating) : null,
    priceLevel: typeof body.priceLevel === 'string' ? body.priceLevel.slice(0, 40) : '',
    proposedDate,
    proposedHour,
    duration,
    outdoor: !!body.outdoor,
    votes: [],
    status: 'open',
    createdAt: new Date().toISOString()
  }
}

function toClient(t) {
  return {
    id: t._id,
    name: t.name,
    destination: t.destination,
    startDate: t.startDate,
    endDate: t.endDate,
    travellers: t.travellers,
    stops: t.stops || [],
    wishlist: t.wishlist || [],
    decisions: t.decisions || [],
    memberPreferences: t.memberPreferences || []
  }
}

// Clean the stops sent by the browser. Returns null if anything is invalid.
function cleanStops(list) {
  if (!Array.isArray(list) || list.length > 100) return null
  const out = []
  for (const s of list) {
    if (!s || typeof s !== 'object') return null
    const name = typeof s.name === 'string' ? s.name.trim() : ''
    if (!name || name.length > 120) return null
    if (typeof s.date !== 'string' || !DATE_PATTERN.test(s.date)) return null
    const hour = Number(s.hour)
    if (!Number.isFinite(hour) || hour < 0 || hour >= 24) return null
    let duration = null
    if (s.duration !== null && s.duration !== undefined) {
      duration = Number(s.duration)
      if (!Number.isFinite(duration) || duration <= 0 || duration > 24) return null
    }
    const address = typeof s.address === 'string' && s.address.trim() ? s.address.trim().slice(0, 200) : null
    out.push({
      id: String(s.id || new mongoose.Types.ObjectId()).slice(0, 40),
      name, address, date: s.date, hour, duration,
      outdoor: !!s.outdoor, locked: !!s.locked
    })
  }
  return out
}

function cleanWishlist(list) {
  if (!Array.isArray(list) || list.length > 30) return null
  const out = []
  for (const w of list) {
    if (!w || typeof w !== 'object') return null
    const name = typeof w.name === 'string' ? w.name.trim() : ''
    if (!name || name.length > 120) return null
    const address = typeof w.address === 'string' && w.address.trim() ? w.address.trim().slice(0, 200) : null
    out.push({ id: String(w.id || new mongoose.Types.ObjectId()).slice(0, 40), name, address })
  }
  return out
}

// GET /api/trips -> the logged-in user's trips, newest first
router.get('/', requireAuth, async (req, res) => {
  const trips = await Trip.find({ owner: req.userId }).sort({ createdAt: -1 })
  res.json(trips.map(toClient))
})

// POST /api/trips  { name, destination, startDate?, endDate?, travellers? }
router.post('/', requireAuth, async (req, res) => {
  const name = (req.body.name || '').trim()
  const destination = (req.body.destination || '').trim()
  const startDate = req.body.startDate || ''
  const endDate = req.body.endDate || ''

  if (!name || !destination) return res.status(400).json({ message: 'Trip name and destination are required.' })
  if (name.length > 80 || destination.length > 80) return res.status(400).json({ message: 'Name and destination must be 80 characters or fewer.' })
  if ((startDate && !DATE_PATTERN.test(startDate)) || (endDate && !DATE_PATTERN.test(endDate))) {
    return res.status(400).json({ message: 'Dates must look like 2026-10-12.' })
  }
  if (startDate && endDate && endDate < startDate) {
    return res.status(400).json({ message: 'The end date must be on or after the start date.' })
  }

  let travellers = Array.isArray(req.body.travellers) ? req.body.travellers : []
  travellers = travellers.map((n) => String(n).trim()).filter(Boolean).slice(0, 10)
  if (!travellers.length) {
    const user = await User.findById(req.userId)
    if (user) travellers = [user.name] // default: just the creator
  }

  const trip = await Trip.create({ owner: req.userId, name, destination, startDate, endDate, travellers })
  res.status(201).json(toClient(trip))
})

// GET /api/trips/discover?source=places|events&destination=...&query=...
// API keys stay on the server and are never sent to the browser.
router.get('/discover', requireAuth, async (req, res) => {
  const source = req.query.source === 'events' ? 'events' : 'places'
  const destination = String(req.query.destination || '').trim().slice(0, 100)
  const query = String(req.query.query || '').trim().slice(0, 100)
  if (!destination || !query) return res.status(400).json({ message: 'Destination and search words are required.' })

  try {
    if (source === 'places') {
      if (!process.env.GOOGLE_MAPS_API_KEY) {
        return res.status(503).json({ message: 'Add GOOGLE_MAPS_API_KEY to server/.env to search places.' })
      }
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.primaryTypeDisplayName,places.rating,places.priceLevel,places.googleMapsUri'
        },
        body: JSON.stringify({ textQuery: `${query} in ${destination}`, pageSize: 8 }),
        signal: AbortSignal.timeout(10000)
      })
      if (!response.ok) {
        console.error('Places search error:', response.status, (await response.text()).slice(0, 500))
        return res.status(502).json({ message: 'Google Places search failed. Check that Places API (New) is enabled.' })
      }
      const data = await response.json()
      const candidates = (data.places || []).map((place) => ({
        externalId: place.id,
        name: place.displayName && place.displayName.text,
        address: place.formattedAddress || '',
        category: (place.primaryTypeDisplayName && place.primaryTypeDisplayName.text) || 'Place',
        rating: place.rating || null,
        priceLevel: place.priceLevel ? place.priceLevel.replace('PRICE_LEVEL_', '').toLowerCase() : '',
        url: place.googleMapsUri || '',
        source: 'google'
      })).filter((item) => item.name)
      return res.json({ candidates })
    }

    if (!process.env.TICKETMASTER_API_KEY) {
      return res.status(503).json({ message: 'Add TICKETMASTER_API_KEY to server/.env to search events.' })
    }
    const params = new URLSearchParams({
      apikey: process.env.TICKETMASTER_API_KEY,
      city: destination.split(',')[0].trim(),
      keyword: query,
      size: '8',
      sort: 'date,asc'
    })
    const response = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`, {
      signal: AbortSignal.timeout(10000)
    })
    if (!response.ok) {
      console.error('Ticketmaster search error:', response.status)
      return res.status(502).json({ message: 'Ticketmaster event search failed. Check the configured API key.' })
    }
    const data = await response.json()
    const events = (data._embedded && data._embedded.events) || []
    const candidates = events.map((event) => {
      const venue = event._embedded && event._embedded.venues && event._embedded.venues[0]
      const classification = event.classifications && event.classifications[0]
      return {
        externalId: event.id,
        name: event.name,
        address: venue ? [venue.name, venue.address && venue.address.line1].filter(Boolean).join(', ') : '',
        category: (classification && classification.segment && classification.segment.name) || 'Event',
        url: event.url || '',
        source: 'ticketmaster',
        suggestedDate: event.dates && event.dates.start && event.dates.start.localDate,
        suggestedHour: Number((event.dates && event.dates.start && event.dates.start.localTime || '10:00').slice(0, 2))
      }
    })
    res.json({ candidates })
  } catch (err) {
    console.error('Candidate search error:', err.message)
    res.status(502).json({ message: 'The suggestion service did not respond in time.' })
  }
})

// GET /api/trips/:id
router.get('/:id', requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Trip not found.' })
  const trip = await Trip.findOne({ _id: req.params.id, owner: req.userId })
  if (!trip) return res.status(404).json({ message: 'Trip not found.' })
  res.json(toClient(trip))
})

// GET /api/trips/:id/decisions
router.get('/:id/decisions', requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Trip not found.' })
  const trip = await Trip.findOne({ _id: req.params.id, owner: req.userId })
  if (!trip) return res.status(404).json({ message: 'Trip not found.' })
  res.json(decisionState(trip))
})

// POST /api/trips/:id/decisions - add a place/event/manual idea to the ballot
router.post('/:id/decisions', requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Trip not found.' })
  const trip = await Trip.findOne({ _id: req.params.id, owner: req.userId })
  if (!trip) return res.status(404).json({ message: 'Trip not found.' })
  const candidate = cleanCandidate(req.body)
  if (!candidate) return res.status(400).json({ message: 'Add a name, valid date, start hour and duration.' })
  if (trip.startDate && candidate.proposedDate < trip.startDate) return res.status(400).json({ message: 'The proposed date is before the trip starts.' })
  if (trip.endDate && candidate.proposedDate > trip.endDate) return res.status(400).json({ message: 'The proposed date is after the trip ends.' })
  if ((trip.decisions || []).length >= 40) return res.status(400).json({ message: 'This trip already has 40 decision candidates.' })
  const duplicate = (trip.decisions || []).some((d) => candidate.externalId && d.source === candidate.source && d.externalId === candidate.externalId)
  if (duplicate) return res.status(409).json({ message: 'That option is already on the ballot.' })
  trip.decisions.push(candidate)
  trip.markModified('decisions')
  await trip.save()
  res.status(201).json(decisionState(trip))
})

// PUT /api/trips/:id/decisions/:decisionId/vote { traveller, vote: yes|no|clear }
router.put('/:id/decisions/:decisionId/vote', requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Trip not found.' })
  const trip = await Trip.findOne({ _id: req.params.id, owner: req.userId })
  if (!trip) return res.status(404).json({ message: 'Trip not found.' })
  const candidate = (trip.decisions || []).find((d) => d.id === req.params.decisionId)
  if (!candidate) return res.status(404).json({ message: 'Decision candidate not found.' })
  if (candidate.status === 'scheduled') return res.status(409).json({ message: 'This option already reached quorum and is locked into the itinerary.' })

  const traveller = uniqueTravellers(trip.travellers).find((name) => name.toLowerCase() === String(req.body.traveller || '').trim().toLowerCase())
  const vote = req.body.vote
  if (!traveller || !['yes', 'no', 'clear'].includes(vote)) return res.status(400).json({ message: 'Choose a traveller and a valid vote.' })
  candidate.votes = (candidate.votes || []).filter((v) => String(v.traveller).toLowerCase() !== traveller.toLowerCase())
  if (vote !== 'clear') candidate.votes.push({ traveller, value: vote })

  const yesVotes = new Set(candidate.votes.filter((v) => v.value === 'yes').map((v) => String(v.traveller).toLowerCase())).size
  let justScheduled = false
  if (yesVotes >= quorumFor(trip)) {
    candidate.status = 'scheduled'
    candidate.scheduledAt = new Date().toISOString()
    const stopId = `vote-${candidate.id}`
    if (!(trip.stops || []).some((stop) => stop.id === stopId)) {
      trip.stops.push({
        id: stopId,
        name: candidate.name,
        address: candidate.address || null,
        date: candidate.proposedDate,
        hour: candidate.proposedHour,
        duration: candidate.duration,
        outdoor: !!candidate.outdoor,
        locked: true,
        sourceDecisionId: candidate.id
      })
      justScheduled = true
    }
  }
  trip.markModified('decisions')
  trip.markModified('stops')
  await trip.save()
  res.json({ ...decisionState(trip), justScheduled, itinerary: trip.stops })
})

// DELETE /api/trips/:id/decisions/:decisionId - remove an open candidate
router.delete('/:id/decisions/:decisionId', requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Trip not found.' })
  const trip = await Trip.findOne({ _id: req.params.id, owner: req.userId })
  if (!trip) return res.status(404).json({ message: 'Trip not found.' })
  const candidate = (trip.decisions || []).find((d) => d.id === req.params.decisionId)
  if (!candidate) return res.status(404).json({ message: 'Decision candidate not found.' })
  if (candidate.status === 'scheduled') return res.status(409).json({ message: 'Scheduled decisions cannot be removed from the ballot.' })
  trip.decisions = trip.decisions.filter((d) => d.id !== req.params.decisionId)
  trip.markModified('decisions')
  await trip.save()
  res.json(decisionState(trip))
})

// PUT /api/trips/:id/compatibility { traveller, pace, budget }
router.put('/:id/compatibility', requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Trip not found.' })
  const trip = await Trip.findOne({ _id: req.params.id, owner: req.userId })
  if (!trip) return res.status(404).json({ message: 'Trip not found.' })
  const traveller = uniqueTravellers(trip.travellers).find((name) => name.toLowerCase() === String(req.body.traveller || '').trim().toLowerCase())
  if (!traveller || !PACE_LEVELS.includes(req.body.pace) || !BUDGET_LEVELS.includes(req.body.budget)) {
    return res.status(400).json({ message: 'Choose a valid traveller, pace and budget.' })
  }
  trip.memberPreferences = (trip.memberPreferences || []).filter((p) => String(p.traveller).toLowerCase() !== traveller.toLowerCase())
  trip.memberPreferences.push({ traveller, pace: req.body.pace, budget: req.body.budget })
  trip.markModified('memberPreferences')
  await trip.save()
  res.json(decisionState(trip))
})

// PUT /api/trips/:id/itinerary  { stops: [...], wishlist: [...] }
router.put('/:id/itinerary', requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Trip not found.' })
  const stops = cleanStops(req.body.stops)
  const wishlist = cleanWishlist(req.body.wishlist)
  if (!stops || !wishlist) return res.status(400).json({ message: 'Some itinerary details are invalid.' })

  const trip = await Trip.findOne({ _id: req.params.id, owner: req.userId })
  if (!trip) return res.status(404).json({ message: 'Trip not found.' })
  trip.stops = stops
  trip.wishlist = wishlist
  trip.markModified('stops')
  trip.markModified('wishlist')
  await trip.save()
  res.json({ ok: true })
})

// DELETE /api/trips/:id
router.delete('/:id', requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Trip not found.' })
  const result = await Trip.deleteOne({ _id: req.params.id, owner: req.userId })
  if (!result.deletedCount) return res.status(404).json({ message: 'Trip not found.' })
  res.json({ ok: true })
})

export default router
