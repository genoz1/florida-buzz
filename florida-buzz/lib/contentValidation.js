class ContentValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContentValidationError';
    this.code = 'invalid_ai_output';
  }
}

const ARTICLE_CATEGORIES = new Set([
  'theme-parks', 'space', 'beaches', 'florida-living', 'wildlife',
  'cruises', 'food', 'events', 'travel-deals',
]);

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentValidationError(`${label} must be an object.`);
  }
}

function requireString(value, field, { max = null, min = 1 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min) {
    throw new ContentValidationError(`${field} is missing or incomplete.`);
  }
  if (max && value.trim().length > max) {
    throw new ContentValidationError(`${field} exceeds ${max} characters.`);
  }
}

function requireHtml(value, field = 'body_html') {
  requireString(value, field, { min: 80 });
  if (!/<(?:p|h2|h3|ul|ol|li)\b/i.test(value)) {
    throw new ContentValidationError(`${field} does not contain expected article HTML.`);
  }
}

function validateNewsArticle(article) {
  requireObject(article, 'article');
  if (article.skip === true) {
    requireString(article.reason, 'reason');
    return article;
  }
  requireString(article.title, 'title', { max: 100 });
  requireString(article.meta_title, 'meta_title', { max: 80 });
  requireString(article.category, 'category');
  if (!ARTICLE_CATEGORIES.has(article.category)) {
    throw new ContentValidationError(`category is not supported: ${article.category}`);
  }
  requireString(article.dek, 'dek', { max: 200 });
  requireHtml(article.body_html);
  requireString(article.fb_caption, 'fb_caption');
  requireString(article.pin_title, 'pin_title', { max: 140 });
  requireString(article.pin_description, 'pin_description', { max: 600 });
  return article;
}

function validateGuide(guide) {
  requireObject(guide, 'guide');
  requireString(guide.title, 'title', { max: 100 });
  requireString(guide.dek, 'dek', { max: 200 });
  requireHtml(guide.body_html);
  requireString(guide.fb_caption, 'fb_caption');
  requireString(guide.pin_title, 'pin_title', { max: 140 });
  requireString(guide.pin_description, 'pin_description', { max: 600 });
  return guide;
}

function validateTopic(topic) {
  requireObject(topic, 'topic selection');
  requireString(topic.topic, 'topic');
  requireString(topic.working_title, 'working_title', { max: 100 });
  return topic;
}

function validateReview(review) {
  requireObject(review, 'review');
  requireString(review.title, 'title', { max: 100 });
  requireString(review.meta_title, 'meta_title', { max: 80 });
  requireString(review.dek, 'dek', { max: 200 });
  requireHtml(review.body_html);
  requireString(review.fb_caption, 'fb_caption');
  requireString(review.pin_title, 'pin_title', { max: 140 });
  requireString(review.pin_description, 'pin_description', { max: 600 });
  return review;
}

function validateRoundup(roundup) {
  requireObject(roundup, 'roundup');
  requireString(roundup.title, 'title', { max: 100 });
  requireString(roundup.meta_title, 'meta_title', { max: 100 });
  requireString(roundup.dek, 'dek', { max: 200 });
  requireHtml(roundup.body_html);
  requireString(roundup.fb_caption, 'fb_caption');
  return roundup;
}

function validateEngagementPost(post) {
  requireObject(post, 'engagement post');
  requireString(post.topic, 'topic');
  requireString(post.message, 'message', { max: 400 });
  return post;
}

function validateFeaturePromo(caption) {
  requireObject(caption, 'feature promotion');
  requireString(caption.message, 'message', { max: 400 });
  requireString(caption.pin_title, 'pin_title', { max: 140 });
  requireString(caption.pin_description, 'pin_description', { max: 600 });
  return caption;
}

function validateDiningDirectory(restaurants) {
  if (!Array.isArray(restaurants) || restaurants.length === 0) {
    throw new ContentValidationError('Dining directory must contain at least one restaurant.');
  }
  restaurants.forEach((restaurant, index) => {
    requireObject(restaurant, `restaurant ${index + 1}`);
    requireString(restaurant.name, `restaurant ${index + 1} name`);
    requireString(restaurant.land, `restaurant ${index + 1} land`);
    if (!['quick-service', 'table-service'].includes(restaurant.service_type)) {
      throw new ContentValidationError(`restaurant ${index + 1} has an invalid service_type.`);
    }
    if (!['required', 'recommended', 'not-accepted', 'walk-up-only'].includes(restaurant.reservations)) {
      throw new ContentValidationError(`restaurant ${index + 1} has invalid reservations.`);
    }
    if (typeof restaurant.character_dining !== 'boolean') {
      throw new ContentValidationError(`restaurant ${index + 1} has invalid character_dining.`);
    }
    if (!Array.isArray(restaurant.meal_periods)) {
      throw new ContentValidationError(`restaurant ${index + 1} has invalid meal_periods.`);
    }
    requireString(restaurant.description, `restaurant ${index + 1} description`);
  });
  return restaurants;
}

module.exports = {
  ARTICLE_CATEGORIES,
  ContentValidationError,
  validateNewsArticle,
  validateGuide,
  validateTopic,
  validateReview,
  validateRoundup,
  validateEngagementPost,
  validateFeaturePromo,
  validateDiningDirectory,
};
