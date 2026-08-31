const mongoose = require('mongoose');

/**
 * BuffetReservation — user reserves a slot at a live buffet.
 *
 * Payment integration is on hold. Structure is payment-ready:
 * paymentStatus: 'pending' until payment goes live.
 *
 * Status flow:
 *   reserved → arrived → completed
 *           ↘ cancelled (user or owner)
 *           ↘ no_show   (user didn't arrive)
 */
const buffetReservationSchema = new mongoose.Schema(
  {
    buffet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Buffet',
      required: [true, 'Buffet reference is required'],
    },
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      required: [true, 'Hotel reference is required'],
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
    },

    // ─── Reservation Details ──────────────────────────────────────────────────
    buffetDate: {
      type: Date,
      required: [true, 'Buffet date is required'],
    },
    partySize: {
      type: Number,
      default: 1,
      min: [1, 'Party size must be at least 1'],
      max: [50, 'Party size cannot exceed 50'],
    },
    specialRequests: {
      type: String,
      trim: true,
      maxlength: [500, 'Special requests cannot exceed 500 characters'],
    },

    // ─── Status ───────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['reserved', 'arrived', 'completed', 'cancelled', 'no_show'],
      default: 'reserved',
    },
    reservedAt: {
      type: Date,
      default: Date.now,
    },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: null },
    cancelledBy: {
      type: String,
      enum: ['user', 'hotel', 'admin', null],
      default: null,
    },

    // ─── Payment (on hold — structure ready for Razorpay integration) ─────────
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'refunded', 'failed'],
      default: 'pending',
    },
    paymentAmount: { type: Number, default: null },
    paymentOrderId: { type: String, default: null }, // Razorpay order ID
    paymentId: { type: String, default: null },       // Razorpay payment ID

    // ─── Denormalized for quick display ───────────────────────────────────────
    buffetName: { type: String, trim: true },
    hotelName: { type: String, trim: true },
    pricePerPerson: { type: Number },
    city: { type: String, trim: true },
    area: { type: String, trim: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
buffetReservationSchema.index({ buffet: 1, user: 1 });
buffetReservationSchema.index({ buffet: 1, status: 1 });
buffetReservationSchema.index({ user: 1, buffetDate: -1 }); // user history
buffetReservationSchema.index({ hotel: 1, buffetDate: -1 }); // hotel's customers
buffetReservationSchema.index({ status: 1, createdAt: -1 });

// ─── Virtual: totalAmount ─────────────────────────────────────────────────────
buffetReservationSchema.virtual('totalAmount').get(function () {
  if (!this.pricePerPerson || !this.partySize) return null;
  return this.pricePerPerson * this.partySize;
});

module.exports = mongoose.model('BuffetReservation', buffetReservationSchema);
