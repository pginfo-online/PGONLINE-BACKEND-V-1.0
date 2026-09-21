const path = require('path');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}

const backendModules = 'c:/Users/ADMIN/Desktop/pgInfoonline/backend/node_modules';
require(path.join(backendModules, 'dotenv')).config({ path: 'c:/Users/ADMIN/Desktop/pgInfoonline/backend/.env' });
const mongoose = require('mongoose');
const connectDB = require('../config/db');

async function auditImages() {
  try {
    await connectDB();
    const db = mongoose.connection.db;

    const propsCollection = db.collection('properties');
    const pgsCollection = db.collection('pgs');

    // 1. Audit 'properties' collection (category: 'pg')
    const totalPgProps = await propsCollection.countDocuments({ category: 'pg' });
    const pgPropsWithPhotos = await propsCollection.countDocuments({
      category: 'pg',
      'photos.0': { $exists: true }
    });
    const pgPropsWithoutPhotos = await propsCollection.countDocuments({
      category: 'pg',
      $or: [
        { photos: { $exists: false } },
        { photos: { $size: 0 } },
        { photos: null }
      ]
    });

    // Cloudinary vs other domains in properties
    const propsSample = await propsCollection.find({
      category: 'pg',
      'photos.0': { $exists: true }
    }).project({ photos: 1, title: 1, owner: 1 }).toArray();

    let propsCloudinaryCount = 0;
    let propsOtherImageCount = 0;
    let totalPhotosCount = 0;

    propsSample.forEach(p => {
      const pCount = p.photos ? p.photos.length : 0;
      totalPhotosCount += pCount;
      const hasCloudinary = p.photos.some(img => {
        const u = typeof img === 'string' ? img : img?.url || '';
        return u.includes('cloudinary.com') || u.includes('res.cloudinary');
      });
      if (hasCloudinary) propsCloudinaryCount++;
      else propsOtherImageCount++;
    });

    // 2. Audit 'pgs' collection
    const totalPgs = await pgsCollection.countDocuments();
    const pgsWithPhotos = await pgsCollection.countDocuments({
      'photos.0': { $exists: true }
    });
    const pgsWithoutPhotos = await pgsCollection.countDocuments({
      $or: [
        { photos: { $exists: false } },
        { photos: { $size: 0 } },
        { photos: null }
      ]
    });

    // 3. Audit specific owner: worknaiinter10@gmail.com (6a716669785e054ce4bae80c)
    const ownerId = new mongoose.Types.ObjectId("6a716669785e054ce4bae80c");
    const ownerTotalProps = await propsCollection.countDocuments({ owner: ownerId, category: 'pg' });
    const ownerPropsWithPhotos = await propsCollection.countDocuments({
      owner: ownerId,
      category: 'pg',
      'photos.0': { $exists: true }
    });
    const ownerPropsWithoutPhotos = await propsCollection.countDocuments({
      owner: ownerId,
      category: 'pg',
      $or: [
        { photos: { $exists: false } },
        { photos: { $size: 0 } },
        { photos: null }
      ]
    });

    console.log(JSON.stringify({
      propertiesCollection: {
        totalPGs: totalPgProps,
        withActualImages: pgPropsWithPhotos,
        percentageWithImages: ((pgPropsWithPhotos / totalPgProps) * 100).toFixed(2) + '%',
        withoutImages: pgPropsWithoutPhotos,
        hostedOnCloudinary: propsCloudinaryCount,
        otherImageUrls: propsOtherImageCount,
        totalImagesStored: totalPhotosCount,
        averageImagesPerPG: (totalPhotosCount / (pgPropsWithPhotos || 1)).toFixed(1)
      },
      pgsCollection: {
        totalPGs: totalPgs,
        withActualImages: pgsWithPhotos,
        percentageWithImages: ((pgsWithPhotos / totalPgs) * 100).toFixed(2) + '%',
        withoutImages: pgsWithoutPhotos
      },
      currentOwner: {
        ownerId: "6a716669785e054ce4bae80c",
        totalListings: ownerTotalProps,
        withActualImages: ownerPropsWithPhotos,
        withoutImages: ownerPropsWithoutPhotos
      }
    }, null, 2));

    await mongoose.disconnect();
  } catch (err) {
    console.error('Audit error:', err);
  }
}

auditImages();
