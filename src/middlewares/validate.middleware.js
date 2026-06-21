/**
 * Zod schema validation middleware factory
 * @param {ZodSchema} schema - Zod schema to validate against
 * @param {'body'|'query'|'params'} source - Where to validate
 */
const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);

  if (!result.success) {
    const errors = result.error.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }

  req[source] = result.data;
  next();
};

module.exports = validate;
