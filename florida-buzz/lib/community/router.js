const express = require('express');

const FILTERS = new Set(['buzzing', 'latest', 'disney', 'universal', 'cruises', 'florida-life']);
const CATEGORY_LABELS = {
  disney: 'Disney',
  universal: 'Universal',
  cruises: 'Cruises',
  'florida-life': 'Florida Life',
};

function timeAgo(value, now = new Date()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.floor((now.getTime() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function createCommunityRouter({ store, service, authMiddleware, csrf, config }) {
  const router = express.Router();
  router.use(express.json({ limit: '20kb', strict: true }));
  router.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  function sendError(res, error) {
    const allowed = new Set([
      'already_reported', 'authentication_required', 'cannot_report_own_content',
      'contact_information_not_allowed', 'content_unavailable', 'duplicate_content',
      'forbidden', 'html_not_allowed', 'invalid_category', 'invalid_content',
      'invalid_discussion', 'invalid_moderation_action', 'invalid_reply_target',
      'invalid_report_details', 'invalid_report_reason', 'invalid_slug',
      'links_not_allowed', 'rate_limited', 'security_service_unavailable',
    ]);
    const status = Number(error?.status) || 503;
    if (error?.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
    return res.status(status).json({ error: allowed.has(error?.code) ? error.code : 'community_unavailable' });
  }

  const secureWrite = [csrf.requireToken, authMiddleware.requireAuth];

  router.get('/', authMiddleware.optionalAuth, async (req, res, next) => {
    try {
      const filter = FILTERS.has(req.query.filter) ? req.query.filter : 'buzzing';
      // The curated launch inventory contains 36 questions. Fetch through the
      // RPC's existing 50-row ceiling so every launch discussion remains
      // discoverable from Buzzing and Latest without inventing pagination.
      const discussions = await store.listFeed(filter, 50, 0);
      const featured = filter === 'buzzing'
        ? discussions.find((discussion) => Number(discussion.genuine_activity_count) > 0) || null
        : null;
      res.set('Cache-Control', 'private, no-store');
      res.render('buzz', {
        category: null,
        categoryLabels: CATEGORY_LABELS,
        discussions: featured ? discussions.filter((discussion) => discussion.id !== featured.id) : discussions,
        featured,
        filter,
        isBuzzPage: true,
        timeAgo,
        user: req.auth?.user || null,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/moderation', authMiddleware.requireAuth, authMiddleware.requireRole('moderator', 'admin'), async (req, res, next) => {
    try {
      const queue = await store.listModerationQueue();
      res.set('Cache-Control', 'private, no-store');
      res.render('buzz-moderation', {
        category: null,
        isBuzzPage: true,
        queue,
        timeAgo,
        user: req.auth.user,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/discussions', ...secureWrite, authMiddleware.requireRole('admin'), async (req, res) => {
    try {
      const result = await service.createDiscussion(req.body, { user: req.auth.user, ip: req.ip });
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/discussions/:discussionId/responses', ...secureWrite, async (req, res) => {
    try {
      const result = await service.submitResponse({
        discussionId: req.params.discussionId,
        parentResponseId: null,
        body: req.body?.body,
      }, { user: req.auth.user, ip: req.ip });
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/responses/:responseId/replies', ...secureWrite, async (req, res) => {
    try {
      const target = await store.getResponse(req.params.responseId);
      const result = await service.submitResponse({
        discussionId: target?.discussion_id || '',
        parentResponseId: req.params.responseId,
        body: req.body?.body,
      }, { user: req.auth.user, ip: req.ip });
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/responses/:responseId/reaction', ...secureWrite, async (req, res) => {
    try {
      res.json(await service.toggleReaction({ responseId: req.params.responseId }, { user: req.auth.user, ip: req.ip }));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/responses/:responseId/report', ...secureWrite, async (req, res) => {
    try {
      res.status(201).json(await service.report({
        responseId: req.params.responseId,
        reason: req.body?.reason,
        details: req.body?.details,
      }, { user: req.auth.user, ip: req.ip }));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/moderation/responses/:responseId', ...secureWrite, authMiddleware.requireRole('moderator', 'admin'), async (req, res) => {
    try {
      res.json(await service.moderateResponse({
        responseId: req.params.responseId,
        action: req.body?.action,
        reason: req.body?.reason,
      }, { user: req.auth.user, ip: req.ip }));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/moderation/discussions/:discussionId', ...secureWrite, authMiddleware.requireRole('moderator', 'admin'), async (req, res) => {
    try {
      res.json(await service.moderateDiscussion({
        discussionId: req.params.discussionId,
        action: req.body?.action,
        reason: req.body?.reason,
      }, { user: req.auth.user, ip: req.ip }));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/moderation/profiles/:profileId', ...secureWrite, authMiddleware.requireRole('admin'), async (req, res) => {
    try {
      res.json(await service.moderateProfile({
        profileId: req.params.profileId,
        action: req.body?.action,
        reason: req.body?.reason,
      }, { user: req.auth.user, ip: req.ip }));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/:slug', authMiddleware.optionalAuth, async (req, res, next) => {
    try {
      const discussion = await store.getDiscussionBySlug(req.params.slug, req.auth?.user?.id);
      if (!discussion) return next();
      const responseMap = new Map(discussion.responses.map((response) => [response.id, { ...response, replies: [] }]));
      const responses = [];
      for (const response of responseMap.values()) {
        if (response.parentResponseId && responseMap.has(response.parentResponseId)) {
          responseMap.get(response.parentResponseId).replies.push(response);
        } else if (!response.parentResponseId) {
          responses.push(response);
        }
      }
      let facebookConversation = discussion.facebookConversation;
      if (facebookConversation) {
        const commentMap = new Map(facebookConversation.comments.map((comment) => [comment.id, { ...comment, replies: [] }]));
        const comments = [];
        for (const comment of commentMap.values()) {
          if (comment.parentId && commentMap.has(comment.parentId)) {
            commentMap.get(comment.parentId).replies.push(comment);
          } else {
            comments.push(comment);
          }
        }
        facebookConversation = { ...facebookConversation, comments };
      }
      service.recordImpression(discussion.id, { user: req.auth?.user, ip: req.ip }).catch(() => {});
      res.set('Cache-Control', 'private, no-store');
      res.render('buzz-discussion', {
        category: null,
        categoryLabels: CATEGORY_LABELS,
        discussion: { ...discussion, facebookConversation, responses },
        isBuzzPage: true,
        timeAgo,
        turnstileSiteKey: config.turnstileSiteKey,
        user: req.auth?.user || null,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { CATEGORY_LABELS, FILTERS, createCommunityRouter, timeAgo };
