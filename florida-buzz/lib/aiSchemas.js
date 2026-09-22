// Provider-neutral JSON Schemas for every structured AI response in Florida Buzz.
// Runtime content validation still runs after schema decoding; these schemas make
// malformed/non-JSON provider output fail before it can reach publishing code.

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

function objectSchema(properties) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const socialProperties = {
  fb_caption: { type: 'string' },
  pin_title: { type: 'string' },
  pin_description: { type: 'string' },
};

const newsArticle = {
  name: 'florida_buzz_news_article',
  schema: objectSchema({
    skip: { type: 'boolean' },
    reason: nullableString,
    title: nullableString,
    meta_title: nullableString,
    category: {
      anyOf: [
        { type: 'string', enum: ['theme-parks', 'space', 'beaches', 'florida-living', 'wildlife', 'cruises', 'food', 'events', 'travel-deals'] },
        { type: 'null' },
      ],
    },
    dek: nullableString,
    body_html: nullableString,
    fb_caption: nullableString,
    pin_title: nullableString,
    pin_description: nullableString,
  }),
};

const guide = {
  name: 'florida_buzz_guide',
  schema: objectSchema({
    title: { type: 'string' },
    dek: { type: 'string' },
    body_html: { type: 'string' },
    ...socialProperties,
  }),
};

const topic = {
  name: 'florida_buzz_guide_topic',
  schema: objectSchema({
    topic: { type: 'string' },
    working_title: { type: 'string' },
  }),
};

const review = {
  name: 'florida_buzz_review',
  schema: objectSchema({
    title: { type: 'string' },
    meta_title: { type: 'string' },
    dek: { type: 'string' },
    body_html: { type: 'string' },
    ...socialProperties,
  }),
};

const roundup = {
  name: 'florida_buzz_city_roundup',
  schema: objectSchema({
    title: { type: 'string' },
    meta_title: { type: 'string' },
    dek: { type: 'string' },
    body_html: { type: 'string' },
    fb_caption: { type: 'string' },
  }),
};

const engagementPost = {
  name: 'florida_buzz_engagement_post',
  schema: objectSchema({
    topic: { type: 'string' },
    message: { type: 'string' },
  }),
};

const featurePromo = {
  name: 'florida_buzz_feature_promo',
  schema: objectSchema({
    message: { type: 'string' },
    pin_title: { type: 'string' },
    pin_description: { type: 'string' },
  }),
};

const restaurant = objectSchema({
  name: { type: 'string' },
  land: { type: 'string' },
  service_type: { type: 'string', enum: ['quick-service', 'table-service'] },
  reservations: { type: 'string', enum: ['required', 'recommended', 'not-accepted', 'walk-up-only'] },
  dining_plan: nullableString,
  character_dining: { type: 'boolean' },
  characters: nullableString,
  meal_periods: {
    type: 'array',
    items: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snacks'] },
  },
  description: { type: 'string' },
});

const diningDirectory = {
  name: 'florida_buzz_dining_directory',
  schema: objectSchema({
    restaurants: { type: 'array', items: restaurant },
  }),
};

module.exports = {
  newsArticle,
  guide,
  topic,
  review,
  roundup,
  engagementPost,
  featurePromo,
  diningDirectory,
};
