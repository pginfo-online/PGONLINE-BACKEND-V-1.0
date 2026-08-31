const mongoose = require('mongoose');

/**
 * MeetupParticipant Model
 *
 * Dedicated participation/registration record — replaces the embedded rsvpList
 * array inside Meetup documents.
 *
 * Design decisions:
 *  - Unique compound index { meetupId, userId } → prevents duplicate registrations
 *  - Atomic findOneAndUpdate used for capacity-safe joins (race condition safe)
 *  - Supports full lifecycle: interested → requested → approved/waitlisted → attended
 *  - Future-proof: ticketType, paymentStatus, rating, feedback ready for Phase 2
 */

// ─── Participant Status Machine ───────────────────────────────────────────────
// interested:  soft signal — "I want to go someday" (no seat reserved)
// requested:   formal join request (pending organizer approval)
// approved:    organizer approved the request
// confirmed:   user confirmed attendance
// waitlisted:  capacity full, queued for cancellation slots
// cancelled:   user or organizer cancelled
// attended:    checked in on the day
// no_show:     registered but didn't attend
// rejected:    organizer rejected the request
const PARTICIPANT_STATUSES = [
  'interested',
  'requested',
  'approved',
  'confirmed',
  'waitlisted',
  'cancelled',
  'attended',
  'no_show',
  'rejected',
];

const meetupParticipantSchema = new mongoose.Schema(
  {
    // ─── References ───────────────────────────────────────────────────────────
    meetup: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Meetup',
      required: [true, 'Meetup reference is required'],
      index: true,
    },
    /**
     * occurrenceId — for future recurring meetup occurrences.
     * null = one-time meetup or the base occurrence.
     */
    occurrenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true,
    },

    // ─── Lifecycle ────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: PARTICIPANT_STATUSES,
      default: 'interested',
      index: true,
    },

    // ─── Timestamps ───────────────────────────────────────────────────────────
    joinedAt:   { type: Date, default: Date.now },
    approvedAt: { type: Date, default: null },
    cancelledAt:{ type: Date, default: null },
    checkInTime:  { type: Date, default: null },
    checkOutTime: { type: Date, default: null },

    // ─── Attendance ───────────────────────────────────────────────────────────
    attendanceStatus: {
      type: String,
      enum: ['present', 'absent', 'partial', null],
      default: null,
    },

    // ─── Cancellation ─────────────────────────────────────────────────────────
    cancellationReason: { type: String, trim: true, default: null },
    cancelledBy: {
      type: String,
      enum: ['user', 'organizer', 'admin', null],
      default: null,
    },

    // ─── Future: Ticketing & Payments ─────────────────────────────────────────
    ticketType: {
      type: String,
      trim: true,
      default: 'general',   // general | early_bird | vip | etc.
    },
    paymentStatus: {
      type: String,
      enum: ['free', 'pending', 'paid', 'refunded', 'failed'],
      default: 'free',
    },
    paymentAmount: { type: Number, default: 0 },
    paymentRef:    { type: String, default: null },

    // ─── Post-event ───────────────────────────────────────────────────────────
    rating:   { type: Number, min: 1, max: 5, default: null },
    feedback: { type: String, trim: true, maxlength: 1000, default: null },

    // ─── Waitlist management ──────────────────────────────────────────────────
    waitlistPosition: { type: Number, default: null }, // 1-indexed position in queue
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// CRITICAL: unique compound index prevents any duplicate registration
meetupParticipantSchema.index({ meetup: 1, user: 1 }, { unique: true });

// Queries for counting confirmed participants per meetup
meetupParticipantSchema.index({ meetup: 1, status: 1 });

// Organizer view: list all participants for a meetup ordered by join time
meetupParticipantSchema.index({ meetup: 1, joinedAt: 1 });

// Waitlist ordering: promote by earliest joinedAt
meetupParticipantSchema.index({ meetup: 1, status: 1, waitlistPosition: 1 });

// User's participation history
meetupParticipantSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('MeetupParticipant', meetupParticipantSchema);
