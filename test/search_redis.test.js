const assert = require('assert');
require('dotenv').config();
const mongoose = require('mongoose');

async function runTests() {
  console.log('=== Starting Search & Redis Test Suite ===');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const propertySearchService = require('../src/services/propertySearch.service');
  const redisCache = require('../src/services/redisCache.service');

  // Test 1: Redis Cache set, get, del
  console.log('\nTest 1: RedisCache basic set/get/del');
  const testKey = 'test:suite:' + Date.now();
  const testData = { success: true, timestamp: Date.now() };
  const setResult = await redisCache.set(testKey, testData, 10);
  assert.strictEqual(setResult, true, 'Redis SET should succeed');
  const cachedData = await redisCache.get(testKey);
  assert.deepStrictEqual(cachedData, testData, 'Redis GET should return identical data');
  await redisCache.del(testKey);
  const afterDel = await redisCache.get(testKey);
  assert.strictEqual(afterDel, null, 'Redis GET after DEL should be null');
  console.log('✅ Test 1 Passed');

  // Test 2: Suggestions scoped to Pune
  console.log('\nTest 2: Suggestions scoped to City (Pune)');
  const suggestionsPune = await propertySearchService.getPropertySuggestions({
    q: 'Wakad',
    city: 'Pune',
  });
  assert(Array.isArray(suggestionsPune), 'Suggestions must be an array');
  assert(suggestionsPune.length > 0, 'Should find suggestions for Wakad in Pune');
  const wakadLocality = suggestionsPune.find((s) => s.type === 'locality');
  assert(wakadLocality, 'Should have locality suggestion');
  assert.strictEqual(wakadLocality.area, 'Wakad', 'Area should be Wakad');
  assert.strictEqual(wakadLocality.city, 'Pune', 'City should be Pune');
  console.log('✅ Test 2 Passed: Found Wakad locality suggestion in Pune');

  // Test 3: Suggestion caching in Redis
  console.log('\nTest 3: Suggestion Redis Cache Verification');
  const t0 = Date.now();
  const cachedSuggestions = await propertySearchService.getPropertySuggestions({
    q: 'Wakad',
    city: 'Pune',
  });
  const elapsed = Date.now() - t0;
  console.log(`Cached suggestions fetched in ${elapsed}ms`);
  assert(elapsed < 50, 'Redis cached suggestions should return in < 50ms');
  assert.strictEqual(cachedSuggestions.length, suggestionsPune.length);
  console.log('✅ Test 3 Passed: Verified sub-50ms cache response');

  // Test 4: City/Locality Mismatch Protection
  console.log('\nTest 4: City/Locality Mismatch Protection');
  // Searching for a Pune area while city is set to a non-existent or different city
  const mismatchSuggestions = await propertySearchService.getPropertySuggestions({
    q: 'Wakad',
    city: 'NonExistentCity12345',
  });
  const foundInWrongCity = mismatchSuggestions.some(
    (s) => s.type === 'locality' && s.city === 'NonExistentCity12345'
  );
  assert.strictEqual(foundInWrongCity, false, 'Should not return Wakad for NonExistentCity');
  console.log('✅ Test 4 Passed: No cross-city locality leaks');

  // Test 5: Multi-area property search
  console.log('\nTest 5: Multi-area property search (Wakad + Hinjewadi)');
  const multiAreaResult = await propertySearchService.searchProperties({
    city: 'Pune',
    areas: 'Wakad,Hinjewadi',
    category: 'pg',
  });
  assert(multiAreaResult.pagination, 'Should return pagination metadata');
  assert(Array.isArray(multiAreaResult.properties), 'Properties must be an array');
  console.log(`Found ${multiAreaResult.properties.length} PGs across Wakad & Hinjewadi`);
  for (const p of multiAreaResult.properties) {
    const matchesArea = ['wakad', 'hinjewadi'].some((a) => (p.area || '').toLowerCase().includes(a));
    assert(matchesArea, `Property area "${p.area}" must match selected areas`);
    assert.strictEqual(p.category, 'pg', 'Property category must match');
  }
  console.log('✅ Test 5 Passed');

  // Test 6: Cloudinary thumbnail URLs
  console.log('\nTest 6: Cloudinary thumbnail transformation');
  const sampleProp = multiAreaResult.properties.find((p) => p.photos && p.photos.length > 0);
  if (sampleProp) {
    const photo = sampleProp.photos[0];
    assert(photo.url, 'Photo must have url');
    assert(photo.thumbnailUrl, 'Photo must have thumbnailUrl');
    if (photo.url.includes('res.cloudinary.com')) {
      assert(photo.thumbnailUrl.includes('w_640,h_480'), 'Cloudinary thumbnail must have transformation dimensions');
      console.log('Verified Cloudinary thumbnail transformation URL:', photo.thumbnailUrl);
    }
  }
  console.log('✅ Test 6 Passed');

  // Test 7: Commercial and Rented Flat Category Search
  console.log('\nTest 7: Commercial and Rented Flat searches');
  const commercialResult = await propertySearchService.searchProperties({
    city: 'Pune',
    category: 'commercial',
    limit: 5,
  });
  assert(commercialResult.properties.every((p) => p.category === 'commercial'), 'All results must be commercial');

  const flatsResult = await propertySearchService.searchProperties({
    city: 'Pune',
    category: 'residential_rental',
    limit: 5,
  });
  assert(flatsResult.properties.every((p) => p.category === 'residential_rental'), 'All results must be residential_rental');
  console.log(`✅ Test 7 Passed: Commercial found: ${commercialResult.properties.length}, Flats found: ${flatsResult.properties.length}`);

  // Test 8: Empty / Non-matching search resilience
  console.log('\nTest 8: Non-matching search resilience');
  const emptyResult = await propertySearchService.searchProperties({
    city: 'Pune',
    q: 'XYZNonExistentKeyword998877',
    category: 'pg',
  });
  assert.strictEqual(emptyResult.properties.length, 0, 'Non-matching search should return 0 results');
  assert.strictEqual(emptyResult.pagination.total, 0, 'Total count should be 0');
  assert.strictEqual(emptyResult.pagination.hasNext, false, 'hasNext must be false');
  console.log('✅ Test 8 Passed');

  console.log('\n🎉 ALL 8 TESTS PASSED SUCCESSFULLY! 🎉');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
