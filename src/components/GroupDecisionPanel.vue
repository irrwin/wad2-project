<template>
  <div>
    <section class="card p-4 mb-4">
      <div class="d-flex flex-wrap justify-content-between gap-2 align-items-start">
        <div>
          <h4 class="mb-1">Pace & budget compatibility</h4>
          <p class="text-muted mb-0">Complete this when someone joins so mismatches surface before bookings.</p>
        </div>
        <span class="badge" :class="compatibilityBadge">{{ compatibilityLabel }}</span>
      </div>

      <div class="row g-2 mt-2 align-items-end">
        <div class="col-md-4">
          <label class="form-label">Traveller</label>
          <select v-model="profile.traveller" class="form-select" @change="loadProfile">
            <option v-for="name in travellersList" :key="name" :value="name">{{ name }}</option>
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label">Preferred pace</label>
          <select v-model="profile.pace" class="form-select">
            <option value="relaxed">Relaxed</option>
            <option value="balanced">Balanced</option>
            <option value="packed">Packed schedule</option>
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label">Budget style</label>
          <select v-model="profile.budget" class="form-select">
            <option value="budget">Backpacker</option>
            <option value="midrange">Mid-range</option>
            <option value="luxury">Luxury</option>
          </select>
        </div>
        <div class="col-md-2">
          <button class="btn btn-primary w-100" :disabled="savingProfile" @click="saveProfile">
            {{ savingProfile ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>

      <div class="d-flex flex-wrap gap-2 mt-3">
        <span v-for="p in compatibility.profiles" :key="p.traveller" class="profile-pill">
          <strong>{{ p.traveller }}</strong>
          <span v-if="p.pace && p.budget">{{ pretty(p.pace) }} · {{ pretty(p.budget) }}</span>
          <span v-else class="text-warning">Not completed</span>
        </span>
      </div>
      <div v-for="issue in compatibility.issues" :key="issue.field" class="alert py-2 mt-3 mb-0" :class="issue.level === 'high' ? 'alert-danger' : 'alert-warning'">
        <strong>{{ pretty(issue.field) }} mismatch:</strong> {{ issue.message }}
      </div>
    </section>

    <section class="card p-4 mb-4">
      <div class="d-flex flex-wrap justify-content-between gap-2 align-items-start">
        <div>
          <h4 class="mb-1">Find ideas for {{ destination }}</h4>
          <p class="text-muted mb-0">Search live places or events, then put the best options to a vote.</p>
        </div>
        <button class="btn btn-outline-secondary btn-sm" @click="startManual">+ Add manually</button>
      </div>

      <form class="row g-2 mt-2" @submit.prevent="searchCandidates">
        <div class="col-md-3">
          <select v-model="search.source" class="form-select" aria-label="Suggestion source">
            <option value="places">Places & restaurants</option>
            <option value="events">Local events</option>
          </select>
        </div>
        <div class="col-md-7">
          <input v-model.trim="search.query" class="form-control" :placeholder="search.source === 'places' ? 'e.g. affordable ramen or museums' : 'e.g. concerts or comedy'">
        </div>
        <div class="col-md-2">
          <button class="btn btn-primary w-100" :disabled="searching">
            {{ searching ? 'Searching…' : 'Search' }}
          </button>
        </div>
      </form>

      <div v-if="results.length" class="row g-2 mt-2">
        <div v-for="result in results" :key="result.source + result.externalId" class="col-md-6">
          <div class="border rounded p-3 h-100 d-flex justify-content-between gap-3">
            <div>
              <strong>{{ result.name }}</strong>
              <div class="small text-muted">{{ result.category }}<span v-if="result.rating"> · ★ {{ result.rating }}</span></div>
              <div class="small text-muted">{{ result.address }}</div>
            </div>
            <button class="btn btn-outline-primary btn-sm align-self-start" @click="prepareCandidate(result)">Add</button>
          </div>
        </div>
      </div>

      <form v-if="editingCandidate" class="candidate-editor mt-3" @submit.prevent="addCandidate">
        <h6>{{ draft.source === 'manual' ? 'Add an idea' : 'Schedule details before voting' }}</h6>
        <div class="row g-2">
          <div class="col-md-6">
            <label class="form-label">Name</label>
            <input v-model.trim="draft.name" class="form-control" maxlength="120" required>
          </div>
          <div class="col-md-6">
            <label class="form-label">Address</label>
            <input v-model.trim="draft.address" class="form-control" maxlength="200">
          </div>
          <div class="col-6 col-md-3">
            <label class="form-label">Proposed date</label>
            <input v-model="draft.proposedDate" type="date" class="form-control" :min="startDate || undefined" :max="endDate || undefined" required>
          </div>
          <div class="col-6 col-md-3">
            <label class="form-label">Start time</label>
            <input v-model.number="draft.proposedHour" type="number" min="0" max="23" class="form-control" required>
          </div>
          <div class="col-6 col-md-3">
            <label class="form-label">Duration (hours)</label>
            <input v-model.number="draft.duration" type="number" min="0.5" max="12" step="0.5" class="form-control" required>
          </div>
          <div class="col-6 col-md-3 d-flex align-items-end">
            <div class="form-check mb-2">
              <input id="candidate-outdoor" v-model="draft.outdoor" type="checkbox" class="form-check-input">
              <label for="candidate-outdoor" class="form-check-label">Outdoor activity</label>
            </div>
          </div>
        </div>
        <div class="d-flex gap-2 mt-3">
          <button class="btn btn-success btn-sm" :disabled="savingCandidate">{{ savingCandidate ? 'Adding…' : 'Add to ballot' }}</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" @click="editingCandidate = false">Cancel</button>
        </div>
      </form>
    </section>

    <section>
      <div class="d-flex flex-wrap justify-content-between gap-2 align-items-end mb-3">
        <div>
          <h4 class="mb-1">Group ballot</h4>
          <p class="text-muted mb-0">{{ quorum }} yes votes out of {{ travellersList.length }} travellers schedules an option automatically.</p>
        </div>
        <div>
          <label class="form-label small mb-1">Voting as</label>
          <select v-model="selectedTraveller" class="form-select form-select-sm">
            <option v-for="name in travellersList" :key="name" :value="name">{{ name }}</option>
          </select>
        </div>
      </div>

      <div v-if="notice" class="alert alert-success py-2">{{ notice }}</div>
      <div v-if="error" class="alert alert-warning py-2">{{ error }}</div>
      <p v-if="loading" class="text-muted">Loading group decisions…</p>
      <div v-else-if="!candidates.length" class="card p-4 text-center text-muted">
        <h5>No candidates yet</h5>
        <p class="mb-0">Search for a place or event above, or add an idea manually.</p>
      </div>

      <div class="row g-3">
        <div v-for="candidate in candidates" :key="candidate.id" class="col-lg-6">
          <article
            class="card p-3 h-100 vote-card"
            :class="{ scheduled: candidate.status === 'scheduled' }"
            @touchstart="startSwipe($event, candidate)"
            @touchend="finishSwipe($event, candidate)">
            <div class="d-flex justify-content-between gap-2">
              <div>
                <span class="badge bg-light text-dark me-1">{{ candidate.category || 'Activity' }}</span>
                <span class="badge" :class="candidate.status === 'scheduled' ? 'bg-success' : 'bg-secondary'">
                  {{ candidate.status === 'scheduled' ? 'Scheduled' : 'Voting' }}
                </span>
                <h5 class="mt-2 mb-1">{{ candidate.name }}</h5>
                <p class="small text-muted mb-1">{{ candidate.address }}</p>
                <p class="small mb-2">{{ formatDate(candidate.proposedDate) }} at {{ formatHour(candidate.proposedHour) }} · {{ candidate.duration }} hr</p>
              </div>
              <button v-if="candidate.status !== 'scheduled'" class="btn-close" aria-label="Remove candidate" @click="removeCandidate(candidate)"></button>
            </div>

            <div class="progress mb-2" style="height: 8px">
              <div class="progress-bar bg-success" :style="{ width: Math.min(100, yesCount(candidate) / quorum * 100) + '%' }"></div>
            </div>
            <div class="small fw-semibold mb-2">{{ yesCount(candidate) }} yes · {{ noCount(candidate) }} no · quorum {{ quorum }}</div>
            <div class="d-flex flex-wrap gap-1 mb-3">
              <span v-for="name in travellersList" :key="name" class="vote-pill" :class="voteClass(candidate, name)">
                {{ name }}: {{ voteLabel(candidate, name) }}
              </span>
            </div>

            <div v-if="candidate.status === 'scheduled'" class="alert alert-success py-2 mb-0">
              Consensus reached—this is now locked into the itinerary.
            </div>
            <div v-else class="mt-auto">
              <div class="d-flex gap-2">
                <button class="btn btn-outline-danger flex-grow-1" :disabled="votingId === candidate.id" @click="vote(candidate, 'no')">← Pass</button>
                <button class="btn btn-outline-secondary" :disabled="votingId === candidate.id" @click="vote(candidate, 'clear')">Clear</button>
                <button class="btn btn-success flex-grow-1" :disabled="votingId === candidate.id" @click="vote(candidate, 'yes')">Vote yes →</button>
              </div>
              <div class="small text-muted text-center mt-2">On touch screens: swipe left to pass, right to vote yes.</div>
            </div>
          </article>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import axios from 'axios'

const demoCandidates = [
  { id: 'demo-namsan', name: 'Namsan Park & Hiking', address: 'Namsan, Seoul', category: 'Outdoor', source: 'manual', proposedDate: '2026-10-14', proposedHour: 14, duration: 3, outdoor: true, votes: [{ traveller: 'Sarah', value: 'yes' }], status: 'open' },
  { id: 'demo-coex', name: 'COEX Mall', address: 'Gangnam, Seoul', category: 'Shopping', source: 'manual', proposedDate: '2026-10-14', proposedHour: 14, duration: 3, outdoor: false, votes: [{ traveller: 'John', value: 'yes' }], status: 'open' }
]

export default {
  props: {
    tripId: { type: String, required: true },
    destination: { type: String, required: true },
    travellers: { type: Array, default: () => [] },
    startDate: { type: String, default: '' },
    endDate: { type: String, default: '' },
    demo: { type: Boolean, default: false }
  },
  emits: ['decision-scheduled'],
  data() {
    return {
      loading: true,
      error: '',
      notice: '',
      candidates: [],
      quorum: 1,
      selectedTraveller: '',
      compatibility: { status: 'incomplete', missing: [], issues: [], profiles: [] },
      profile: { traveller: '', pace: 'balanced', budget: 'midrange' },
      savingProfile: false,
      search: { source: 'places', query: '' },
      searching: false,
      results: [],
      editingCandidate: false,
      savingCandidate: false,
      draft: {},
      votingId: '',
      swipeStart: {}
    }
  },
  computed: {
    travellersList() {
      return this.travellers.length ? this.travellers : ['Traveller']
    },
    compatibilityLabel() {
      return { incomplete: 'Profiles incomplete', mismatch: 'Mismatch found', review: 'Discuss differences', aligned: 'Group aligned' }[this.compatibility.status]
    },
    compatibilityBadge() {
      return { incomplete: 'bg-secondary', mismatch: 'bg-danger', review: 'bg-warning text-dark', aligned: 'bg-success' }[this.compatibility.status]
    }
  },
  async mounted() {
    this.selectedTraveller = this.travellersList[0]
    this.profile.traveller = this.travellersList[0]
    if (this.demo) this.loadDemo()
    else await this.loadDecisions()
    this.loading = false
  },
  methods: {
    applyState(data) {
      this.candidates = data.candidates || []
      this.quorum = data.quorum || 1
      this.compatibility = data.compatibility || this.compatibility
      this.loadProfile()
    },
    async loadDecisions() {
      try {
        const { data } = await axios.get(`/api/trips/${this.tripId}/decisions`)
        this.applyState(data)
      } catch (err) {
        this.error = this.apiMessage(err, 'Could not load group decisions.')
      }
    },
    loadDemo() {
      const saved = localStorage.getItem('tripsync-demo-decisions')
      const state = saved ? JSON.parse(saved) : {}
      this.candidates = state.candidates || structuredClone(demoCandidates)
      this.quorum = Math.floor(this.travellersList.length / 2) + 1
      this.compatibility = this.localCompatibility(state.profiles || [])
      this.loadProfile()
    },
    persistDemo() {
      localStorage.setItem('tripsync-demo-decisions', JSON.stringify({ candidates: this.candidates, profiles: this.compatibility.profiles.filter((p) => p.pace && p.budget) }))
    },
    async searchCandidates() {
      this.error = ''
      this.notice = ''
      if (!this.search.query) {
        this.error = 'Enter what the group is interested in.'
        return
      }
      this.searching = true
      try {
        const { data } = await axios.get('/api/trips/discover', { params: { ...this.search, destination: this.destination } })
        this.results = data.candidates || []
        if (!this.results.length) this.error = 'No matching suggestions were found. Try broader words or add one manually.'
      } catch (err) {
        this.error = this.apiMessage(err, 'Could not search suggestions. You can still add an idea manually.')
      }
      this.searching = false
    },
    defaultDate(suggested = '') {
      if (suggested && (!this.startDate || suggested >= this.startDate) && (!this.endDate || suggested <= this.endDate)) return suggested
      return this.startDate || new Date().toISOString().slice(0, 10)
    },
    prepareCandidate(candidate) {
      this.draft = {
        ...candidate,
        proposedDate: this.defaultDate(candidate.suggestedDate),
        proposedHour: Number.isInteger(candidate.suggestedHour) ? candidate.suggestedHour : 10,
        duration: 2,
        outdoor: false
      }
      this.editingCandidate = true
    },
    startManual() {
      this.draft = { name: '', address: '', category: 'Activity', source: 'manual', externalId: '', url: '', proposedDate: this.defaultDate(), proposedHour: 10, duration: 2, outdoor: false }
      this.editingCandidate = true
    },
    async addCandidate() {
      this.error = ''
      if (!this.draft.name || !this.draft.proposedDate) {
        this.error = 'Add a name and proposed date.'
        return
      }
      this.savingCandidate = true
      try {
        if (this.demo) {
          this.candidates.unshift({ ...this.draft, id: `demo-${Date.now()}`, votes: [], status: 'open' })
          this.persistDemo()
        } else {
          const { data } = await axios.post(`/api/trips/${this.tripId}/decisions`, this.draft)
          this.applyState(data)
        }
        this.results = []
        this.editingCandidate = false
        this.notice = 'Candidate added to the group ballot.'
      } catch (err) {
        this.error = this.apiMessage(err, 'Could not add that candidate.')
      }
      this.savingCandidate = false
    },
    async vote(candidate, value) {
      if (!this.selectedTraveller || candidate.status === 'scheduled') return
      this.error = ''
      this.notice = ''
      this.votingId = candidate.id
      try {
        if (this.demo) {
          candidate.votes = (candidate.votes || []).filter((v) => v.traveller !== this.selectedTraveller)
          if (value !== 'clear') candidate.votes.push({ traveller: this.selectedTraveller, value })
          if (this.yesCount(candidate) >= this.quorum) {
            candidate.status = 'scheduled'
            this.notice = `${candidate.name} reached quorum and was added to the itinerary.`
            this.$emit('decision-scheduled', { demo: true, candidate })
          }
          this.persistDemo()
        } else {
          const { data } = await axios.put(`/api/trips/${this.tripId}/decisions/${candidate.id}/vote`, { traveller: this.selectedTraveller, vote: value })
          this.applyState(data)
          if (data.justScheduled) {
            this.notice = `${candidate.name} reached quorum and was added to the itinerary.`
            this.$emit('decision-scheduled', { itinerary: data.itinerary })
          }
        }
      } catch (err) {
        this.error = this.apiMessage(err, 'Could not save that vote.')
      }
      this.votingId = ''
    },
    async removeCandidate(candidate) {
      if (!confirm(`Remove "${candidate.name}" from the ballot?`)) return
      try {
        if (this.demo) {
          this.candidates = this.candidates.filter((c) => c.id !== candidate.id)
          this.persistDemo()
        } else {
          const { data } = await axios.delete(`/api/trips/${this.tripId}/decisions/${candidate.id}`)
          this.applyState(data)
        }
      } catch (err) {
        this.error = this.apiMessage(err, 'Could not remove that candidate.')
      }
    },
    loadProfile() {
      const existing = (this.compatibility.profiles || []).find((p) => p.traveller === this.profile.traveller)
      this.profile.pace = existing && existing.pace ? existing.pace : 'balanced'
      this.profile.budget = existing && existing.budget ? existing.budget : 'midrange'
    },
    async saveProfile() {
      this.error = ''
      this.savingProfile = true
      try {
        if (this.demo) {
          const profiles = (this.compatibility.profiles || []).filter((p) => p.traveller !== this.profile.traveller && p.pace && p.budget)
          profiles.push({ ...this.profile })
          this.compatibility = this.localCompatibility(profiles)
          this.persistDemo()
        } else {
          const { data } = await axios.put(`/api/trips/${this.tripId}/compatibility`, this.profile)
          this.applyState(data)
        }
        this.notice = `${this.profile.traveller}'s travel style was saved.`
      } catch (err) {
        this.error = this.apiMessage(err, 'Could not save that travel profile.')
      }
      this.savingProfile = false
    },
    localCompatibility(profiles) {
      const completed = this.travellersList.map((traveller) => profiles.find((p) => p.traveller === traveller) || { traveller, pace: '', budget: '' })
      const ready = completed.filter((p) => p.pace && p.budget)
      const issues = []
      const pace = ['relaxed', 'balanced', 'packed']
      const budget = ['budget', 'midrange', 'luxury']
      if (ready.length > 1) {
        const paceGap = Math.max(...ready.map((p) => pace.indexOf(p.pace))) - Math.min(...ready.map((p) => pace.indexOf(p.pace)))
        const budgetGap = Math.max(...ready.map((p) => budget.indexOf(p.budget))) - Math.min(...ready.map((p) => budget.indexOf(p.budget)))
        if (paceGap) issues.push({ field: 'pace', level: paceGap >= 2 ? 'high' : 'medium', message: paceGap >= 2 ? 'The group mixes relaxed and packed travel styles.' : 'Some travellers prefer a different daily pace.' })
        if (budgetGap) issues.push({ field: 'budget', level: budgetGap >= 2 ? 'high' : 'medium', message: budgetGap >= 2 ? 'The group mixes backpacker and luxury budgets.' : 'The group should agree on a spending range.' })
      }
      const missing = completed.filter((p) => !p.pace || !p.budget).map((p) => p.traveller)
      const status = issues.some((i) => i.level === 'high') ? 'mismatch' : missing.length ? 'incomplete' : issues.length ? 'review' : 'aligned'
      return { profiles: completed, missing, issues, status }
    },
    yesCount(candidate) {
      return new Set((candidate.votes || []).filter((v) => v.value === 'yes').map((v) => v.traveller)).size
    },
    noCount(candidate) {
      return new Set((candidate.votes || []).filter((v) => v.value === 'no').map((v) => v.traveller)).size
    },
    voteValue(candidate, traveller) {
      const vote = (candidate.votes || []).find((v) => v.traveller === traveller)
      return vote ? vote.value : ''
    },
    voteLabel(candidate, traveller) {
      return this.voteValue(candidate, traveller) || 'waiting'
    },
    voteClass(candidate, traveller) {
      const value = this.voteValue(candidate, traveller)
      return value === 'yes' ? 'vote-yes' : value === 'no' ? 'vote-no' : 'vote-waiting'
    },
    startSwipe(event, candidate) {
      this.swipeStart[candidate.id] = event.changedTouches[0].clientX
    },
    finishSwipe(event, candidate) {
      const start = this.swipeStart[candidate.id]
      if (start === undefined) return
      const delta = event.changedTouches[0].clientX - start
      delete this.swipeStart[candidate.id]
      if (Math.abs(delta) < 60) return
      this.vote(candidate, delta > 0 ? 'yes' : 'no')
    },
    formatDate(date) {
      return new Date(`${date}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
    },
    formatHour(hour) {
      return new Date(2000, 0, 1, Number(hour)).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })
    },
    pretty(value) {
      return String(value || '').replace(/^./, (c) => c.toUpperCase())
    },
    apiMessage(err, fallback) {
      return (err.response && err.response.data && err.response.data.message) || fallback
    }
  }
}
</script>

<style scoped>
.candidate-editor {
  border: 1px solid #d9e2f2;
  border-radius: 0.75rem;
  background: #f8faff;
  padding: 1rem;
}
.vote-card {
  border: 1px solid #dfe5ef;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  touch-action: pan-y;
}
.vote-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 0.5rem 1.25rem rgba(23, 43, 77, 0.08);
}
.vote-card.scheduled {
  border-color: #75b798;
  background: #f5fff8;
}
.vote-pill,
.profile-pill {
  display: inline-flex;
  gap: 0.35rem;
  align-items: center;
  border-radius: 999px;
  padding: 0.3rem 0.65rem;
  font-size: 0.78rem;
  border: 1px solid #dee2e6;
  background: #fff;
}
.vote-yes { color: #146c43; border-color: #75b798; background: #d1e7dd; }
.vote-no { color: #b02a37; border-color: #ea868f; background: #f8d7da; }
.vote-waiting { color: #6c757d; }
</style>
