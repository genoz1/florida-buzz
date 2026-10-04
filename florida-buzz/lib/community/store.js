function throwOnError(error, message) {
  if (error) {
    const wrapped = new Error(message);
    wrapped.code = error.code;
    throw wrapped;
  }
}

function createCommunityStore({ client, now = () => new Date() }) {
  if (!client) throw new Error('Community store requires a service client.');

  async function profilesById(ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const { data, error } = await client.from('profiles')
      .select('user_id, display_name, role, status, created_at')
      .in('user_id', unique);
    throwOnError(error, 'Could not read community profiles.');
    return new Map((data || []).map((profile) => [profile.user_id, profile]));
  }

  return {
    async listFeed(filter = 'buzzing', limit = 30, offset = 0) {
      const { data, error } = await client.rpc('get_buzz_board_feed', {
        p_filter: filter,
        p_limit: limit,
        p_offset: offset,
      });
      throwOnError(error, 'Could not load Buzz Board feed.');
      return data || [];
    },

    async getDiscussionBySlug(slug, viewerId) {
      const { data: discussion, error: discussionError } = await client.from('discussions')
        .select('id, slug, question, context, category, topic, source_type, status, related_article_id, response_count, reaction_count, unique_participant_count, last_activity_at, created_at')
        .eq('slug', slug)
        .in('status', ['published', 'locked'])
        .eq('moderation_status', 'published')
        .maybeSingle();
      throwOnError(discussionError, 'Could not load discussion.');
      if (!discussion) return null;

      const { data: responses, error: responsesError } = await client.from('responses')
        .select('id, discussion_id, author_id, parent_response_id, body, moderation_status, like_count, report_count, created_at, updated_at')
        .eq('discussion_id', discussion.id)
        .eq('moderation_status', 'published')
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      throwOnError(responsesError, 'Could not load discussion responses.');

      let relatedArticle = null;
      const { data: linkedArticle } = await client.from('articles')
        .select('slug, title')
        .eq('buzz_discussion_id', discussion.id)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      relatedArticle = linkedArticle || null;
      if (!relatedArticle && discussion.related_article_id) {
        const { data: originatingArticle } = await client.from('articles')
          .select('slug, title')
          .eq('id', discussion.related_article_id)
          .maybeSingle();
        relatedArticle = originatingArticle || null;
      }

      let facebookConversation = null;
      const { data: facebookPost, error: facebookPostError } = await client.from('facebook_buzz_posts')
        .select('facebook_post_id, permalink_url, published_at')
        .eq('discussion_id', discussion.id)
        .eq('status', 'active')
        .maybeSingle();
      throwOnError(facebookPostError, 'Could not load Facebook conversation mapping.');
      if (facebookPost) {
        const { data: facebookComments, error: facebookCommentsError } = await client.from('facebook_buzz_comments')
          .select('facebook_comment_id, parent_facebook_comment_id, body, commenter_name, commenter_page_scoped_id, permalink_url, facebook_created_at, facebook_updated_at')
          .eq('discussion_id', discussion.id)
          .eq('moderation_status', 'published')
          .eq('is_hidden', false)
          .eq('is_deleted', false)
          .order('facebook_created_at', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true });
        throwOnError(facebookCommentsError, 'Could not load approved Facebook comments.');
        facebookConversation = {
          permalinkUrl: facebookPost.permalink_url,
          publishedAt: facebookPost.published_at,
          comments: (facebookComments || []).map((comment) => ({
            id: comment.facebook_comment_id,
            parentId: comment.parent_facebook_comment_id,
            body: comment.body,
            displayName: comment.commenter_name || 'Facebook commenter',
            commenterId: comment.commenter_page_scoped_id,
            permalinkUrl: comment.permalink_url,
            createdAt: comment.facebook_created_at,
            updatedAt: comment.facebook_updated_at,
          })),
        };
      }

      const profileMap = await profilesById((responses || []).map((response) => response.author_id));
      let viewerReactions = new Set();
      if (viewerId && responses?.length) {
        const { data: reactions, error: reactionError } = await client.from('community_reactions')
          .select('response_id')
          .eq('user_id', viewerId)
          .in('response_id', responses.map((response) => response.id));
        throwOnError(reactionError, 'Could not load viewer reactions.');
        viewerReactions = new Set((reactions || []).map((reaction) => reaction.response_id));
      }

      const substantiveNative = (responses || []).filter((response) => normalizeForIndexing(response.body).length >= 40);
      const substantiveFacebook = (facebookConversation?.comments || []).filter((comment) => normalizeForIndexing(comment.body).length >= 40);
      const substantive = [...substantiveNative, ...substantiveFacebook];
      const knownParticipants = new Set([
        ...substantiveNative.map((response) => `native:${response.author_id}`),
        ...substantiveFacebook.filter((comment) => comment.commenterId).map((comment) => `facebook:${comment.commenterId}`),
      ]);
      const substantiveCharacters = substantive.reduce((total, item) => total + normalizeForIndexing(item.body).length, 0);
      const indexable = substantive.length >= 3
        && substantiveCharacters >= 300
        && (knownParticipants.size >= 2 || substantive.length >= 5);

      return {
        ...discussion,
        relatedArticle,
        facebookConversation,
        indexable,
        responses: (responses || []).map((response) => ({
          id: response.id,
          parentResponseId: response.parent_response_id,
          body: response.body,
          likeCount: response.like_count,
          reportCount: response.report_count,
          createdAt: response.created_at,
          updatedAt: response.updated_at,
          displayName: profileMap.get(response.author_id)?.display_name || 'Florida Buzz reader',
          viewerLiked: viewerReactions.has(response.id),
        })),
      };
    },

    async getResponse(responseId) {
      const { data, error } = await client.from('responses')
        .select('id, discussion_id, author_id, parent_response_id, moderation_status, deleted_at')
        .eq('id', responseId)
        .maybeSingle();
      throwOnError(error, 'Could not load response.');
      return data || null;
    },

    async findRecentDuplicate({ authorId, discussionId, bodyHash, seconds = 300 }) {
      const since = new Date(now().getTime() - seconds * 1000).toISOString();
      const { data, error } = await client.from('responses')
        .select('id')
        .eq('author_id', authorId)
        .eq('discussion_id', discussionId)
        .eq('normalized_body_hash', bodyHash)
        .gte('created_at', since)
        .limit(1);
      throwOnError(error, 'Could not check duplicate response.');
      return !!data?.length;
    },

    async createResponse({ discussionId, authorId, parentResponseId, body, bodyHash, moderationStatus, signals }) {
      const { data, error } = await client.from('responses').insert({
        discussion_id: discussionId,
        author_id: authorId,
        parent_response_id: parentResponseId || null,
        body,
        normalized_body_hash: bodyHash,
        moderation_status: moderationStatus,
        moderation_signals: signals,
      }).select('id, moderation_status, parent_response_id, created_at').single();
      throwOnError(error, 'Could not save response.');
      return data;
    },

    async toggleReaction({ responseId, userId }) {
      const { error: insertError } = await client.from('community_reactions').insert({
        response_id: responseId,
        user_id: userId,
      });
      if (!insertError) return { liked: true };
      if (insertError.code !== '23505') throwOnError(insertError, 'Could not save reaction.');
      const { error: deleteError } = await client.from('community_reactions')
        .delete()
        .eq('response_id', responseId)
        .eq('user_id', userId);
      throwOnError(deleteError, 'Could not remove reaction.');
      return { liked: false };
    },

    async createReport({ responseId, reporterId, reason, details }) {
      const { data, error } = await client.from('community_reports').insert({
        response_id: responseId,
        reporter_id: reporterId,
        reason,
        details: details || null,
      }).select('id').single();
      if (error?.code === '23505') {
        const duplicate = new Error('Report already exists.');
        duplicate.code = '23505';
        throw duplicate;
      }
      throwOnError(error, 'Could not save report.');
      return data;
    },

    async createDiscussion({ slug, question, context, category, topic, createdBy, status = 'published' }) {
      const { data, error } = await client.from('discussions').insert({
        slug,
        question,
        context,
        category,
        topic,
        source_type: 'florida_buzz',
        created_by: createdBy,
        starter_label: 'Florida Buzz',
        status,
        moderation_status: 'published',
      }).select('id, slug').single();
      throwOnError(error, 'Could not create discussion.');
      return data;
    },

    async recordImpression({ discussionId, visitorHash, viewedOn }) {
      const { error } = await client.from('discussion_impressions').upsert({
        discussion_id: discussionId,
        visitor_hash: visitorHash,
        viewed_on: viewedOn,
      }, { onConflict: 'discussion_id,visitor_hash,viewed_on', ignoreDuplicates: true });
      throwOnError(error, 'Could not record discussion impression.');
    },

    async listModerationQueue() {
      const { data: responses, error } = await client.from('responses')
        .select('id, discussion_id, author_id, parent_response_id, body, moderation_status, moderation_signals, moderation_reviewed_at, like_count, report_count, created_at')
        .or('moderation_status.eq.held,and(moderation_status.eq.published,report_count.gt.0,moderation_reviewed_at.is.null)')
        .order('created_at', { ascending: false })
        .limit(100);
      throwOnError(error, 'Could not load moderation queue.');
      const profileMap = await profilesById((responses || []).map((response) => response.author_id));
      const responseIds = (responses || []).map((response) => response.id);
      let reportsByResponse = new Map();
      if (responseIds.length) {
        const { data: reports, error: reportsError } = await client.from('community_reports')
          .select('response_id, reason, details, created_at')
          .in('response_id', responseIds)
          .order('created_at', { ascending: true });
        throwOnError(reportsError, 'Could not load report reasons.');
        for (const report of reports || []) {
          const items = reportsByResponse.get(report.response_id) || [];
          items.push({ reason: report.reason, details: report.details, created_at: report.created_at });
          reportsByResponse.set(report.response_id, items);
        }
      }
      const discussionIds = [...new Set((responses || []).map((response) => response.discussion_id))];
      let discussionMap = new Map();
      if (discussionIds.length) {
        const { data: discussions, error: discussionError } = await client.from('discussions')
          .select('id, slug, question, category, status')
          .in('id', discussionIds);
        throwOnError(discussionError, 'Could not load moderation contexts.');
        discussionMap = new Map((discussions || []).map((discussion) => [discussion.id, discussion]));
      }
      return (responses || []).map((response) => ({
        ...response,
        author_display_name: profileMap.get(response.author_id)?.display_name || 'Florida Buzz reader',
        discussion: discussionMap.get(response.discussion_id) || null,
        reports: reportsByResponse.get(response.id) || [],
      }));
    },

    async moderateResponse({ responseId, moderatorId, action, reason }) {
      const { data, error } = await client.rpc('moderate_community_response', {
        p_response_id: responseId,
        p_moderator_id: moderatorId,
        p_action: action,
        p_reason: reason || null,
      });
      throwOnError(error, 'Could not moderate response.');
      return Array.isArray(data) ? data[0] : data;
    },

    async moderateDiscussion({ discussionId, moderatorId, action, reason }) {
      const { data, error } = await client.rpc('moderate_community_discussion', {
        p_discussion_id: discussionId,
        p_moderator_id: moderatorId,
        p_action: action,
        p_reason: reason || null,
      });
      throwOnError(error, 'Could not moderate discussion.');
      return Array.isArray(data) ? data[0] : data;
    },

    async moderateProfile({ profileId, moderatorId, action, reason }) {
      const { data, error } = await client.rpc('moderate_community_profile', {
        p_profile_id: profileId,
        p_moderator_id: moderatorId,
        p_action: action,
        p_reason: reason || null,
      });
      throwOnError(error, 'Could not moderate profile.');
      return Array.isArray(data) ? data[0] : data;
    },
  };
}

function normalizeForIndexing(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

module.exports = { createCommunityStore };
