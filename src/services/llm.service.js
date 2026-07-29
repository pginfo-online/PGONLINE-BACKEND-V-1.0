const Groq = require('groq-sdk');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

class LLMService {
  constructor() {
    this.provider = (process.env.LLM_PROVIDER || 'groq').toLowerCase();
    this.model = process.env.LLM_MODEL;  // optional override
    this.initClient();
  }

  initClient() {
    switch (this.provider) {
      case 'groq':
        this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
        this.defaultModel = 'llama3-8b-8192';
        break;
      case 'openai':
        this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.defaultModel = 'gpt-3.5-turbo';
        break;
      case 'gemini':
        this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.defaultModel = 'gemini-pro';
        break;
      default:
        throw new Error(`Unsupported LLM_PROVIDER: ${this.provider}`);
    }
  }

  async generateCompletion(messages, options = {}) {
    const model = options.model || this.model || this.defaultModel;
    const temperature = options.temperature ?? 0.2;
    const maxTokens = options.maxTokens || 500;
    const responseFormat = options.responseFormat;

    if (this.provider === 'groq') {
      const completion = await this.client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: responseFormat || undefined,
      });
      return completion.choices[0].message.content;
    }

    if (this.provider === 'openai') {
      const completion = await this.client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: responseFormat,
      });
      return completion.choices[0].message.content;
    }

    if (this.provider === 'gemini') {
      const genAI = this.client;
      const geminiModel = genAI.getGenerativeModel({ model });
      // Convert messages to Gemini format
      const history = messages.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const chat = geminiModel.startChat({ history });
      const lastMessage = messages[messages.length - 1].content;
      const result = await chat.sendMessage(lastMessage);
      const response = result.response;
      return response.text();
    }
  }
}

module.exports = new LLMService();