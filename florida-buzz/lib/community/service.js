const crypto = require('crypto');
const {
  CommunityError,
  normalizePlainText,
  normalizedBodyHash,
  validateCommunityBody,
  validateReportReason,
  validateStarter,
  validateUuid,
} = require('./validation');

function requireRole(user, roles) {
  if (!user || !roles.includes(user.role)) throw new CommunityError('forbidden', 403);
}

function createCommunityService({ store, limiter, classify, analyticsKey, now = () => new Date() }) {
  if (!store || !limiter || !classify) throw new Error('Community service dependencies are required.');

  async function consume(namespace, identifier, limit, windowSeconds) {
    let result;
    try {
      result = await limiter.consume(`community-${namespace}`, identifier, limit, windowSeconds);
    } catch {
      throw new CommunityError('security_service_unavailable', 503);
    }
    if (!result.allowed) {
      const error = new CommunityError('rate_limited', 429);
      error.retryAfterSeconds = result.retryAfterSeconds;
      throw error;
    }
  }

  async function rateLimitWrite(action, user, ip) {
    const limits = {
      response: { user: 10, ip: 20, window: 15 * 60 },
      reply: { user: 15, ip: 25, window: 15 * 60 },
      reaction: { user: 60, ip: 100, window: 15 * 60 },
      report: { user: 10, ip: 20, window: 60 * 60 },
      moderation: { user: 120, ip: 180, window: 15 * 60 },
      discussion: { user: 20, ip: 30, window: 60 * 60 },
    }[action];
    await consume(`${action}-ip`, ip || 'unknown', limits.ip, limits.window);
    await consume(`${action}-user`, user.id, limits.user, limits.window);
  }

  async function submitResponse({ discussionId, parentResponseId, body }, context) {
    const user = context.user;
    if (!user) throw new CommunityError('authentication_required', 401);
    const safeDiscussionId = validateUuid(discussionId, 'invalid_discussion');
    const safeParentId = parentResponseId ? validateUuid(parentResponseId) : null;
    const action = safeParentId ? 'reply' : 'response';
    await rateLimitWrite(action, user, context.ip);

    if (safeParentId) {
      const parent = await store.getResponse(safeParentId);
      if (!parent || parent.discussion_id !== safeDiscussionId || parent.parent_response_id) {
        throw new CommunityError('invalid_reply_target');
      }
    }

    const normalized = validateCommunityBody(body);
    const bodyHash = normalizedBodyHash(normalized);
    if (await store.findRecentDuplicate({
      authorId: user.id,
      discussionId: safeDiscussionId,
      bodyHash,
    })) {
      throw new CommunityError('duplicate_content', 409);
    }

    const moderation = await classify(normalized);
    const status = moderation.decision === 'publish'
      ? 'published'
      : moderation.decision === 'reject' ? 'rejected' : 'held';
    const saved = await store.createResponse({
      discussionId: safeDiscussionId,
      authorId: user.id,
      parentResponseId: safeParentId,
      body: normalized,
      bodyHash,
      moderationStatus: status,
      signals: moderation.signals,
    });
    return {
      id: saved.id,
      kind: safeParentId ? 'reply' : 'response',
      status,
      message: status === 'published'
        ? 'Your response is live.'
        : status === 'held'
          ? 'Your response is being reviewed.'
          : 'Your response could not be published.',
    };
  }

  async function toggleReaction({ responseId }, context) {
    const user = context.user;
    if (!user) throw new CommunityError('authentication_required', 401);
    await rateLimitWrite('reaction', user, context.ip);
    const target = await store.getResponse(validateUuid(responseId));
    if (!target || target.moderation_status !== 'published' || target.deleted_at) {
      throw new CommunityError('content_unavailable', 404);
    }
    return store.toggleReaction({ responseId: target.id, userId: user.id });
  }

  async function report({ responseId, reason, details }, context) {
    const user = context.user;
    if (!user) throw new CommunityError('authentication_required', 401);
    await rateLimitWrite('report', user, context.ip);
    const target = await store.getResponse(validateUuid(responseId));
    if (!target || target.moderation_status !== 'published' || target.deleted_at) {
      throw new CommunityError('content_unavailable', 404);
    }
    if (target.author_id === user.id) throw new CommunityError('cannot_report_own_content');
    const safeDetails = normalizePlainText(details);
    if (safeDetails.length > 500 || /[<>]/.test(safeDetails)) throw new CommunityError('invalid_report_details');
    try {
      await store.createReport({
        responseId: target.id,
        reporterId: user.id,
        reason: validateReportReason(reason),
        details: safeDetails || null,
      });
    } catch (error) {
      if (error.code === '23505') throw new CommunityError('already_reported', 409);
      throw error;
    }
    return { reported: true };
  }

  async function createDiscussion(input, context) {
    const user = context.user;
    requireRole(user, ['admin']);
    await rateLimitWrite('discussion', user, context.ip);
    return store.createDiscussion({ ...validateStarter(input), createdBy: user.id });
  }

  async function moderateResponse(input, context) {
    const user = context.user;
    requireRole(user, ['moderator', 'admin']);
    await rateLimitWrite('moderation', user, context.ip);
    const action = ['approve', 'remove', 'restore'].includes(input.action) ? input.action : '';
    if (!action) throw new CommunityError('invalid_moderation_action');
    return store.moderateResponse({
      responseId: validateUuid(input.responseId),
      moderatorId: user.id,
      action,
      reason: normalizePlainText(input.reason).slice(0, 500) || null,
    });
  }

  async function moderateDiscussion(input, context) {
    const user = context.user;
    requireRole(user, ['moderator', 'admin']);
    await rateLimitWrite('moderation', user, context.ip);
    const action = ['lock', 'unlock'].includes(input.action) ? input.action : '';
    if (!action) throw new CommunityError('invalid_moderation_action');
    return store.moderateDiscussion({
      discussionId: validateUuid(input.discussionId),
      moderatorId: user.id,
      action,
      reason: normalizePlainText(input.reason).slice(0, 500) || null,
    });
  }

  async function moderateProfile(input, context) {
    const user = context.user;
    requireRole(user, ['admin']);
    await rateLimitWrite('moderation', user, context.ip);
    const action = ['suspend', 'block', 'activate'].includes(input.action) ? input.action : '';
    if (!action) throw new CommunityError('invalid_moderation_action');
    return store.moderateProfile({
      profileId: validateUuid(input.profileId),
      moderatorId: user.id,
      action,
      reason: normalizePlainText(input.reason).slice(0, 500) || null,
    });
  }

  async function recordImpression(discussionId, context) {
    const identifier = context.user?.id || context.ip || 'unknown';
    const visitorHash = crypto.createHmac('sha256', analyticsKey)
      .update(`buzz-impression:${identifier}`)
      .digest('hex');
    await store.recordImpression({
      discussionId: validateUuid(discussionId),
      visitorHash,
      viewedOn: now().toISOString().slice(0, 10),
    });
  }

  return {
    createDiscussion,
    moderateDiscussion,
    moderateProfile,
    moderateResponse,
    recordImpression,
    report,
    submitResponse,
    toggleReaction,
  };
}

module.exports = { CommunityError, createCommunityService };
