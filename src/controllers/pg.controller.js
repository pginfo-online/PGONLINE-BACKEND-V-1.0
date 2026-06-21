const asyncHandler = require('../utils/asyncHandler');
const { successResponse, paginatedResponse } = require('../utils/apiResponse');
const pgService = require('../services/pg.service');
const Groq = require('groq-sdk');

/**
 * @route GET /api/v1/pg
 */
const getPGs = asyncHandler(async (req, res) => {
  const { pgs, pagination } = await pgService.getPGs(req.query);
  paginatedResponse(res, 'PG listings retrieved', pgs, pagination);
});

/**
 * @route GET /api/v1/pg/ai-search
 * Uses Groq LLM to parse natural language and extract filters
 */
const aiSearch = asyncHandler(async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ success: false, message: 'Query is required' });
  }

  let intentParams = {};

  if (process.env.GROQ_API_KEY) {
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        model: 'llama3-8b-8192',
        messages: [
          {
            role: 'system',
            content: `You are a strict JSON extraction assistant for PG searches in India. Extract search parameters from user queries.
Return ONLY a raw valid JSON object. Do NOT wrap it in markdown code blocks (\`\`\`json). Do NOT provide any explanations.
Valid JSON fields (all optional):
- city: "Pune" | "Mumbai" | "Delhi" (or other city string)
- area: string (locality name)
- maxRent: number (e.g. if user says "15k" or "under 15000", return 15000)
- minRent: number
- food: "veg" | "nonveg" | "both" | "none"
- foodIncluded: boolean (true if food is mentioned)
- ac: boolean
- gender: "male" | "female" | "any"
- sharingType: "single" | "double" | "triple"`,
          },
          { role: 'user', content: q },
        ],
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: 'json_object' }
      });

      let raw = completion.choices[0]?.message?.content?.trim() || '{}';
      // Strip markdown code block wrappers if the model ignores instructions
      raw = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      intentParams = JSON.parse(raw);
    } catch (error) {
      console.error("AI Search Error:", error);
      // Fallback to keyword search
      intentParams = { q };
    }
  } else {
    // Graceful fallback: keyword search
    intentParams = { q };
  }

  const pgs = await pgService.aiSearchPGs(intentParams);
  successResponse(res, 'AI search results', { pgs, parsedFilters: intentParams });
});

/**
 * @route GET /api/v1/pg/:id
 */
const getPGById = asyncHandler(async (req, res) => {
  const pg = await pgService.getPGById(req.params.id);
  successResponse(res, 'PG details retrieved', { pg });
});

/**
 * @route POST /api/v1/pg
 */
const createPG = asyncHandler(async (req, res) => {
  const pg = await pgService.createPG(req.user._id, req.body);
  successResponse(res, 'PG listing created and submitted for approval', { pg }, 201);
});

/**
 * @route PUT /api/v1/pg/:id
 */
const updatePG = asyncHandler(async (req, res) => {
  const pg = await pgService.updatePG(req.params.id, req.user._id, req.body);
  successResponse(res, 'PG listing updated', { pg });
});

/**
 * @route DELETE /api/v1/pg/:id
 */
const deletePG = asyncHandler(async (req, res) => {
  await pgService.deletePG(req.params.id, req.user._id, req.user.role);
  successResponse(res, 'PG listing deleted');
});

/**
 * @route GET /api/v1/pg/my - Owner's own listings
 */
const getMyPGs = asyncHandler(async (req, res) => {
  const PG = require('../models/PG.model');
  const pgs = await PG.find({ owner: req.user._id }).sort({ createdAt: -1 }).lean();
  successResponse(res, 'Your listings retrieved', { pgs });
});

/**
 * @route GET /api/v1/pg/suggestions
 * Gets real-time suggestions for search bar
 */
const getSuggestions = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const result = await pgService.getSuggestions(q);
  successResponse(res, 'Suggestions retrieved', result);
});

module.exports = { getPGs, getPGById, createPG, updatePG, deletePG, getMyPGs, aiSearch, getSuggestions };
