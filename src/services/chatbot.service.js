const Conversation = require('../models/Conversation.model');
const llmService = require('./llm.service');
const { extractListingData, detectContradictions, getMissingFields } = require('../utils/aiQuality');

const SYSTEM_PROMPT = `You are a PG listing assistant for PgInfo.Online. Your job is to extract structured property information from the user's description and ask for any missing mandatory details.

Always respond with a JSON object with these keys:
- "intent": one of "create_listing", "update_listing", "general_query"
- "extracted": an object containing any PG fields you can extract. Follow this schema:
  {
    "name": "string (PG name)",
    "description": "string",
    "city": "string (e.g., Pune, Mumbai)",
    "area": "string (locality)",
    "address": "string",
    "floors": "number",
    "totalBeds": "number",
    "genderPreference": "male/female/any",
    "amenities": ["wifi", "food", "parking", ...],
    "contactPhone": "string",
    "contactWhatsapp": "string",
    "food": "veg/nonveg/both/none",
    "foodIncluded": "boolean",
    "ac": "boolean",
    "availableRooms": "number"
  }
- "followUpQuestion": a short question to ask for the next missing mandatory field or clarification (if needed). Omit if everything is clear and user seems ready to submit.
- "confidence": number between 0 and 1 indicating how sure you are about the extracted data.

You must return valid JSON only, no markdown.`;

/**
 * Load or create a conversation for a user.
 */
const getOrCreateConversation = async (userId) => {
  let conv = await Conversation.findOne({ user: userId, status: 'active' }).sort({ createdAt: -1 });
  if (!conv) {
    conv = await Conversation.create({ user: userId, currentStep: 'init', status: 'active' });
  }
  return conv;
};

const startNewConversation = async (userId) => {
  await Conversation.updateMany({ user: userId, status: 'active' }, {
    $set: { status: 'cancelled', currentStep: 'completed' },
  });

  return Conversation.create({ user: userId, currentStep: 'init', status: 'active' });
};

/**
 * Process a new user message within an existing conversation.
 */
const processMessage = async (userId, messageText = '', uploadedImages = []) => {
  const conv = await getOrCreateConversation(userId);
  const trimmedMessage = typeof messageText === 'string' ? messageText.trim() : '';

  if (trimmedMessage || uploadedImages.length) {
    conv.messages.push({
      role: 'user',
      content: trimmedMessage || (uploadedImages.length ? '📷 Uploaded images' : 'Started chat'),
    });
  }

  if (uploadedImages.length) {
    conv.images.push(...uploadedImages);
  }

  const llmResponse = await callLLM(conv);
  const { extracted = {}, intent = 'create_listing', followUpQuestion } = llmResponse;

  if (Object.keys(extracted).length) {
    conv.listingData = deepMerge(conv.listingData || {}, extracted);
  }

  const qualityReport = runQualityChecks(conv.listingData || {});
  const missingMandatory = qualityReport.missingMandatory;

  let assistantText = '';
  if (intent === 'general_query') {
    assistantText = "I'm here to help you create a PG listing. Just describe your property naturally!";
  } else {
    assistantText = buildAssistantResponse(conv.listingData || {}, missingMandatory, followUpQuestion, conv.currentStep);
  }

  if (missingMandatory.length === 0) {
    conv.currentStep = 'confirm_submission';
    assistantText += ' Great! Your listing looks ready. You can submit it now.';
  } else if (conv.images.length === 0) {
    conv.currentStep = 'awaiting_images';
    assistantText += ' Please upload a few clear photos of the PG so I can complete the listing.';
  } else {
    conv.currentStep = 'collecting_details';
  }

  conv.messages.push({ role: 'assistant', content: assistantText });
  await conv.save();

  return {
    message: assistantText,
    listingData: conv.listingData,
    missingFields: missingMandatory,
    images: conv.images,
    currentStep: conv.currentStep,
    conversationId: conv._id,
  };
};

/**
 * Finalize and create the PG listing from accumulated data.
 */
const finalizeListing = async (userId, conversationId) => {
  const conv = await Conversation.findOne({ _id: conversationId, user: userId, status: 'active' });
  if (!conv) throw new Error('Conversation not found');

  const normalizedData = normalizeListingData(conv.listingData || {});
  const report = runQualityChecks(normalizedData);

  if (report.missingMandatory.length > 0) {
    throw new Error(`Missing mandatory fields: ${report.missingMandatory.join(', ')}`);
  }

  const pgService = require('./pg.service');
  const pg = await pgService.createPG(userId, normalizedData);

  if (conv.images.length) {
    pg.photos = conv.images.map((img) => ({ url: img.url, publicId: img.publicId, isMain: false }));
    await pg.save();
  }

  conv.status = 'completed';
  conv.currentStep = 'completed';
  await conv.save();

  return pg;
};

// ─── Helper functions ─────────────────────────────────────────

const callLLM = async (conv) => {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `Already collected data: ${JSON.stringify(conv.listingData || {})}. Missing mandatory fields: ${getMissingFields(conv.listingData || {}).join(', ')}` },
    ...conv.messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
  ];

  const raw = await llmService.generateCompletion(messages, {
    responseFormat: { type: 'json_object' },
    maxTokens: 600,
  });

  const cleaned = typeof raw === 'string'
    ? raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    : '';

  try {
    return JSON.parse(cleaned || '{}');
  } catch (e) {
    console.error('LLM JSON parse error:', e, 'raw:', cleaned);
    return { intent: 'create_listing', extracted: {}, followUpQuestion: 'Could you describe your PG again?' };
  }
};

const deepMerge = (target = {}, source = {}) => {
  const output = { ...target };
  for (const key of Object.keys(source)) {
    if (Array.isArray(source[key])) {
      output[key] = source[key];
    } else if (typeof source[key] === 'object' && source[key] !== null) {
      output[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
};

const normalizeListingData = (data = {}) => {
  const normalized = deepMerge({}, data);

  const cityMap = {
    pune: 'Pune',
    mumbai: 'Mumbai',
    delhi: 'Delhi',
    bangalore: 'Bangalore',
    bengaluru: 'Bangalore',
    chennai: 'Chennai',
    hyderabad: 'Hyderabad',
    kolkata: 'Kolkata',
    jaipur: 'Jaipur',
    ahmedabad: 'Ahmedabad',
  };

  const normalizedCity = typeof normalized.city === 'string' ? normalized.city.trim().toLowerCase() : '';
  normalized.city = cityMap[normalizedCity] || normalized.city || 'Other';

  if (!normalized.area) normalized.area = 'Area to be confirmed';
  if (!normalized.address) normalized.address = 'Address to be confirmed';

  const phoneValue = normalizePhone(normalized.contactPhone || normalized.contactWhatsapp);
  normalized.contactPhone = phoneValue || normalized.contactPhone || '';
  normalized.contactWhatsapp = normalizePhone(normalized.contactWhatsapp) || normalized.contactPhone || '';

  normalized.gender = normalizeGender(normalized.gender || normalized.genderPreference || 'any');
  normalized.food = normalizeFood(normalized.food);
  normalized.foodIncluded = Boolean(normalized.foodIncluded);
  normalized.ac = Boolean(normalized.ac);

  if (!normalized.floors && normalized.floors !== 0) normalized.floors = undefined;
  if (!normalized.totalBeds && normalized.totalBeds !== 0) normalized.totalBeds = undefined;
  if (!normalized.availableRooms && normalized.availableRooms !== 0) normalized.availableRooms = undefined;

  const rent = {
    single: normalizeNumber(normalized.rent?.single),
    double: normalizeNumber(normalized.rent?.double),
    triple: normalizeNumber(normalized.rent?.triple),
  };

  const roomTypes = Array.isArray(normalized.roomTypes) ? normalized.roomTypes : [];
  if (roomTypes.length) {
    rent.single = rent.single ?? normalizeNumber(roomTypes.find((r) => r.sharing === 'single')?.rent);
    rent.double = rent.double ?? normalizeNumber(roomTypes.find((r) => r.sharing === 'double')?.rent);
    rent.triple = rent.triple ?? normalizeNumber(roomTypes.find((r) => r.sharing === 'triple')?.rent);
  }

  normalized.rent = rent;
  normalized.facilities = normalizeFacilities(normalized.facilities || normalized.amenities || []);
  normalized.amenities = normalized.facilities;

  return normalized;
};

const normalizePhone = (value) => {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[^0-9]/g, '').slice(-10);
  return cleaned.length === 10 ? cleaned : '';
};

const normalizeNumber = (value) => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeGender = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : 'any';
  if (['male', 'female', 'any'].includes(normalized)) return normalized;
  return 'any';
};

const normalizeFood = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : 'none';
  if (['veg', 'nonveg', 'both', 'none'].includes(normalized)) return normalized;
  return 'none';
};

const normalizeFacilities = (values = []) => {
  const facilityMap = {
    wifi: 'WiFi',
    laundry: 'Laundry',
    parking: 'Parking',
    gym: 'Gym',
    cctv: 'CCTV',
    'power backup': 'Power Backup',
    'hot water': 'Hot Water',
    housekeeping: 'Housekeeping',
    tv: 'TV',
    refrigerator: 'Refrigerator',
    'ro water': 'RO Water',
    'study room': 'Study Room',
    lift: 'Lift',
    'security guard': 'Security Guard',
    'kitchen access': 'Kitchen Access',
  };

  return Array.from(new Set((Array.isArray(values) ? values : []).map((item) => {
    if (typeof item !== 'string') return '';
    const normalized = item.trim().toLowerCase();
    return facilityMap[normalized] || item.trim();
  }).filter(Boolean)));
};

const runQualityChecks = (data) => {
  const mandatory = ['name', 'city', 'area', 'address', 'contactPhone'];
  const missingMandatory = mandatory.filter((field) => !data[field]);
  const hasRent = data.rent?.single || data.rent?.double || data.rent?.triple;
  if (!hasRent) missingMandatory.push('rent (at least one sharing type)');
  const contradictions = detectContradictions(data);
  return { missingMandatory, contradictions };
};

const buildAssistantResponse = (data, missingFields, llmSuggestion, step) => {
  if (step === 'init') return "Hi! Tell me about your PG and I'll fill in the details.";

  let res = '';
  if (Object.keys(data).length === 0) {
    res = "I'm ready to help! Please describe your PG – for example: 'I have a 3‑floor PG in Hinjewadi Phase 1 with 24 beds…'";
  } else {
    res = "I've gathered the following so far:\n\n";
    res += formatListingSummary(data);
    if (missingFields.length > 0) {
      res += `\n\nI still need: ${missingFields.join(', ')}. `;
      res += llmSuggestion || `Could you provide ${missingFields[0]}?`;
    }
  }
  return res;
};

const formatListingSummary = (data) => {
  const parts = [];
  if (data.name) parts.push(`**Name:** ${data.name}`);
  if (data.city) parts.push(`**City:** ${data.city}`);
  if (data.area) parts.push(`**Area:** ${data.area}`);
  if (data.address) parts.push(`**Address:** ${data.address}`);
  if (data.floors) parts.push(`**Floors:** ${data.floors}`);
  if (data.totalBeds) parts.push(`**Total Beds:** ${data.totalBeds}`);
  if (data.genderPreference || data.gender) parts.push(`**Gender:** ${data.genderPreference || data.gender}`);
  const rents = [];
  if (data.roomTypes) data.roomTypes.forEach((r) => rents.push(`${r.sharing}: ₹${r.rent}`));
  if (rents.length) parts.push(`**Rents:** ${rents.join(' | ')}`);
  if (data.amenities?.length || data.facilities?.length) parts.push(`**Amenities:** ${(data.amenities || data.facilities || []).join(', ')}`);
  return parts.join('\n');
};

module.exports = {
  processMessage,
  finalizeListing,
  startNewConversation,
};