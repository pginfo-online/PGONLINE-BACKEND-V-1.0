// require('dotenv').config();
// const mongoose = require('mongoose');
// const bcrypt = require('bcryptjs');
// const User = require('../models/User.model');
// const PG = require('../models/PG.model');

// const MONGO_URI = "mongodb+srv://pginfoonline_db_user:pginfo123@cluster0.cbhwdsj.mongodb.net/pgOnline"


// // process.env.MONGODB_URI || 'mongodb://localhost:27017/pginfo';

// const users = [
//   { name: 'Super Admin', email: 'admin1@pginfo.online', phone: '9999999999', password: 'Admin@123', role: 'admin' },
//   { name: 'Rajesh Sharma', email: 'owner3@pginfo.online', phone: '9876543210', password: 'Owner@123', role: 'owner' },
//   { name: 'Priya Patel', email: 'owner4@pginfo.online', phone: '9876543211', password: 'Owner@123', role: 'owner' },
//   { name: 'Shruti Jadhaav', email: 'owner5@pginfo.online', phone: '9876543201', password: 'Owner@123', role: 'owner' },
//   { name: 'Preeti Patel', email: 'owner6@pginfo.online', phone: '9876943281', password: 'Owner@123', role: 'owner' },
//   { name: 'Ram Patel', email: 'owner7@pginfo.online', phone: '9876043211', password: 'Owner@123', role: 'owner' },
//   { name: 'Yashna Patel', email: 'owner8@pginfo.online', phone: '9876543211', password: 'Owner@123', role: 'owner' },
//   { name: 'Mahi Patel', email: 'owner9@pginfo.online', phone: '9876543211', password: 'Owner@123', role: 'owner' },
//   { name: 'Diya Patel', email: 'owner10@pginfo.online', phone: '9076543211', password: 'Owner@123', role: 'owner' }
// ];

// const getPGData = (ownerId1, ownerId2) => [
//   {
//     owner: ownerId1,
//     name: 'Sunrise PG Hinjewadi',
//     description: 'Fully furnished PG for IT professionals near Hinjewadi Phase 1. Clean rooms, 24/7 security, and home-cooked meals included.',
//     city: 'Pune', area: 'Hinjewadi', address: 'Hinjewadi Phase 1, Near Wipro Circle, Pune 411057',
//     mapsLink: 'https://maps.google.com/?q=Hinjewadi+Pune',
//     rent: { single: 9000, double: 7000, triple: 5500 },
//     food: 'veg', foodIncluded: true, ac: true,
//     gender: 'male',
//     facilities: ['WiFi', 'Laundry', 'CCTV', 'Hot Water', 'Power Backup', 'RO Water'],
//     photos: [
//       { url: 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=800', publicId: 'seed_1_1', isMain: true },
//       { url: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800', publicId: 'seed_1_2', isMain: false },
//     ],
//     contactPhone: '9876543210', contactWhatsapp: '9876543210',
//     status: 'approved', isVerified: true, isAvailable: true, availableRooms: 3,
//     views: 245, inquiries: 18,
//   },
//   {
//     owner: ownerId1,
//     name: 'Green Valley PG Wakad',
//     description: 'Spacious and affordable PG in the heart of Wakad. Walking distance to Xion Mall. Meals optional.',
//     city: 'Pune', area: 'Wakad', address: 'Near Wakad Chowk, Wakad, Pune 411057',
//     mapsLink: 'https://maps.google.com/?q=Wakad+Pune',
//     rent: { single: 8000, double: 6000, triple: 4800 },
//     food: 'both', foodIncluded: false, ac: false,
//     gender: 'any',
//     facilities: ['WiFi', 'Parking', 'CCTV', 'Hot Water', 'Kitchen Access'],
//     photos: [
//       { url: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800', publicId: 'seed_2_1', isMain: true },
//     ],
//     contactPhone: '9876543210', contactWhatsapp: '9876543210',
//     status: 'approved', isVerified: true, isAvailable: true, availableRooms: 5,
//     views: 187, inquiries: 12,
//   },
//   {
//     owner: ownerId2,
//     name: 'TechNest PG Baner',
//     description: 'Premium AC PG for working professionals. Minutes from Baner-Pashan Link Road. Free WiFi & housekeeping.',
//     city: 'Pune', area: 'Baner', address: 'Baner Road, Near Balewadi, Pune 411045',
//     mapsLink: 'https://maps.google.com/?q=Baner+Pune',
//     rent: { single: 12000, double: 9000, triple: 7000 },
//     food: 'veg', foodIncluded: true, ac: true,
//     gender: 'female',
//     facilities: ['WiFi', 'Laundry', 'Gym', 'CCTV', 'Hot Water', 'Power Backup', 'Housekeeping', 'TV'],
//     photos: [
//       { url: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800', publicId: 'seed_3_1', isMain: true },
//       { url: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800', publicId: 'seed_3_2', isMain: false },
//     ],
//     contactPhone: '9876543211', contactWhatsapp: '9876543211',
//     status: 'approved', isVerified: true, isAvailable: true, availableRooms: 2,
//     views: 312, inquiries: 27,
//   },
//   {
//     owner: ownerId2,
//     name: 'Urban Nest PG Hinjewadi Phase 2',
//     description: 'Modern PG with co-working space. Ideal for remote workers and IT employees.',
//     city: 'Pune', area: 'Hinjewadi', address: 'Hinjewadi Phase 2, Pune 411057',
//     mapsLink: 'https://maps.google.com/?q=Hinjewadi+Phase+2+Pune',
//     rent: { single: 10500, double: 8000 },
//     food: 'both', foodIncluded: false, ac: true,
//     gender: 'any',
//     facilities: ['WiFi', 'CCTV', 'Power Backup', 'Hot Water', 'Refrigerator', 'Study Room'],
//     photos: [
//       { url: 'https://images.unsplash.com/photo-1598928506311-c55ded91a20c?w=800', publicId: 'seed_4_1', isMain: true },
//     ],
//     contactPhone: '9876543211',
//     status: 'approved', isVerified: false, isAvailable: true, availableRooms: 4,
//     views: 156, inquiries: 9,
//   },
//   {
//     owner: ownerId1,
//     name: 'Comfort Zone PG Mumbai Andheri',
//     description: 'Affordable PG near Andheri metro. Non-veg food available. Close to BKC.',
//     city: 'Mumbai', area: 'Andheri', address: 'Andheri East, Near Metro Station, Mumbai 400069',
//     mapsLink: 'https://maps.google.com/?q=Andheri+East+Mumbai',
//     rent: { single: 15000, double: 11000, triple: 8000 },
//     food: 'nonveg', foodIncluded: true, ac: false,
//     gender: 'male',
//     facilities: ['WiFi', 'Laundry', 'CCTV', 'Hot Water'],
//     photos: [
//       { url: 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=800&sat=-100', publicId: 'seed_5_1', isMain: true },
//     ],
//     contactPhone: '9876543210',
//     status: 'pending', isVerified: false, isAvailable: true, availableRooms: 6,
//     views: 0, inquiries: 0,
//   },
// ];

// async function seed() {
//   try {
//     await mongoose.connect(MONGO_URI);
//     console.log('✅ Connected to MongoDB');

//     // Clear existing data
//     await Promise.all([User.deleteMany(), PG.deleteMany()]);
//     console.log('🗑️  Cleared existing data');

//     // Create users
//     const createdUsers = await User.create(users);
//     console.log(`👥 Created ${createdUsers.length} users`);

//     const admin = createdUsers.find((u) => u.role === 'admin');
//     const owner1 = createdUsers.find((u) => u.email === 'owner1@pginfo.online');
//     const owner2 = createdUsers.find((u) => u.email === 'owner2@pginfo.online');

//     // Create PGs
//     // const pgData = getPGData(owner1._id, owner2._id);
//    // const createdPGs = await PG.create(pgData);
//     //console.log(`🏠 Created ${createdPGs.length} PG listings`);

//     // console.log('\n✨ Seed complete!');
//     // console.log('─────────────────────────────────');
//     // console.log('Admin:  admin@pginfo.online / Admin@123');
//     // console.log('Owner1: owner1@pginfo.online / Owner@123');
//     // console.log('Owner2: owner2@pginfo.online / Owner@123');
//     // console.log('Tenant: tenant1@pginfo.online / Tenant@123');
//     // console.log('─────────────────────────────────');

//     process.exit(0);
//   } catch (error) {
//     console.error('❌ Seed failed:', error);
//     process.exit(1);
//   }
// }

// seed();



























require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User.model');

// ======================================================
// MongoDB Connection URI
// Store this inside .env file
// ======================================================

// const MONGO_URI = "mongodb+srv://pginfoonline_db_user:pginfo123@cluster0.cbhwdsj.mongodb.net/pgOnline"

const MONGO_URI="mongodb+srv://pginfoonline_db_user:pginfo123@cluster0.cbhwdsj.mongodb.net/pgOnline"
// const MONGO_URI = process.env.MONGODB_URI;

// ======================================================
// Users Seed Data
// ======================================================

const users = [
  {
    name: 'Super Admin',
    email: 'admin1@pginfo.online',
    phone: '9999989999',
    password: 'Admin@PG2026!',
    role: 'admin',
  },

  {
    name: 'Rajesh Sharma',
    email: 'rajesh.sharma@pginfo.online',
    phone: '9236543210',
    password: 'Rajesh@2026!',
    role: 'owner',
  },

  {
    name: 'Priya Patel',
    email: 'priya.patel@pginfo.online',
    phone: '9876543211',
    password: 'Priya@2026!',
    role: 'owner',
  },

  {
    name: 'Shruti Jadhav',
    email: 'shruti.jadhav@pginfo.online',
    phone: '9876543212',
    password: 'Shruti@2026!',
    role: 'owner',
  },

  {
    name: 'Preeti Patil',
    email: 'preeti.patil@pginfo.online',
    phone: '9876543213',
    password: 'Preeti@2026!',
    role: 'owner',
  },

  {
    name: 'Ram Patil',
    email: 'ram.patil@pginfo.online',
    phone: '9876543214',
    password: 'Ram@2026!',
    role: 'owner',
  },

  {
    name: 'Yashna Kulkarni',
    email: 'yashna.kulkarni@pginfo.online',
    phone: '9876543215',
    password: 'Yashna@2026!',
    role: 'owner',
  },

  {
    name: 'Mahi Deshmukh',
    email: 'mahi.deshmukh@pginfo.online',
    phone: '9876543216',
    password: 'Mahi@2026!',
    role: 'owner',
  },

  {
    name: 'Diya Joshi',
    email: 'diya.joshi@pginfo.online',
    phone: '9876543217',
    password: 'Diya@2026!',
    role: 'owner',
  },
];

// ======================================================
// Seed Function
// ======================================================

async function seedUsers() {
  try {
    // ==================================================
    // Connect MongoDB
    // ==================================================

    await mongoose.connect(MONGO_URI);

    console.log('✅ Connected to MongoDB');

    // ==================================================
    // Delete Existing Users
    // ==================================================

    await User.deleteMany();

    console.log('🗑️ Existing users deleted');

    // ==================================================
    // Create Users
    // ==================================================

    const createdUsers = await User.create(users);

    console.log(`👥 ${createdUsers.length} users created successfully`);

    // ==================================================
    // Display Credentials
    // ==================================================

    console.log('\n========================================');
    console.log('✅ USERS SEEDED SUCCESSFULLY');
    console.log('========================================\n');

    createdUsers.forEach((user) => {
      console.log('----------------------------------------');
      console.log(`Name     : ${user.name}`);
      console.log(`Role     : ${user.role}`);
      console.log(`Email    : ${user.email}`);
      console.log(`Password : ${users.find(u => u.email === user.email).password}`);
      console.log('----------------------------------------\n');
    });

    console.log('========================================\n');

    process.exit(0);

  } catch (error) {

    console.error('\n❌ SEED FAILED');
    console.error(error);

    process.exit(1);
  }
}

// ======================================================
// Run Seeder
// ======================================================

seedUsers();

