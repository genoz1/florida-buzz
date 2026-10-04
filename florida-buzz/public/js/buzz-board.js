(function () {
  'use strict';

  let csrfToken = '';
  let challengeId = '';

  const messages = {
    already_reported: 'You already reported this response.',
    authentication_required: 'Please sign in to participate.',
    cannot_report_own_content: 'You cannot report your own response.',
    contact_information_not_allowed: 'Please remove email addresses or phone numbers.',
    duplicate_content: 'That looks like a response you just posted.',
    html_not_allowed: 'Please use plain text only.',
    invalid_content: 'Responses must be between 10 and 1,500 characters.',
    invalid_reply_target: 'That reply target is no longer available.',
    links_not_allowed: 'Links are not allowed in Buzz Board responses.',
    rate_limited: 'You are moving a little too quickly. Please wait and try again.',
    security_service_unavailable: 'The safety service is temporarily unavailable. Nothing was posted.',
    community_unavailable: 'The Buzz Board is temporarily unavailable. Please try again.',
  };

  function analytics(event, properties) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, ...(properties || {}) });
  }

  async function getCsrf() {
    if (csrfToken) return csrfToken;
    const response = await fetch('/internal/auth/csrf', { credentials: 'include' });
    if (!response.ok) throw new Error('security_service_unavailable');
    const body = await response.json();
    csrfToken = body.csrfToken;
    return csrfToken;
  }

  async function postJSON(path, body) {
    const token = await getCsrf();
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify(body || {}),
    });
    const value = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (value.csrfToken) csrfToken = value.csrfToken;
    if (!response.ok) {
      const error = new Error(value.error || 'community_unavailable');
      error.retryAfter = response.headers.get('Retry-After');
      throw error;
    }
    return value;
  }

  function showStatus(element, message, error) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('is-error', !!error);
  }

  function friendly(error) {
    return messages[error.message] || 'Something went wrong. Nothing was posted—please try again.';
  }

  function requireSignIn() {
    analytics('buzz_sign_in_cta', { surface: 'discussion' });
    const panel = document.getElementById('buzz-sign-in');
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      panel.classList.add('attention');
      setTimeout(() => panel.classList.remove('attention'), 900);
    }
  }

  document.querySelectorAll('[data-filter-name]').forEach((link) => {
    link.addEventListener('click', () => analytics('buzz_filter_select', { filter: link.dataset.filterName }));
  });

  const view = document.querySelector('[data-analytics-view]');
  if (view) analytics(view.dataset.analyticsView, { category: view.dataset.category || 'all' });

  const requestForm = document.querySelector('[data-auth-step="request"]');
  const verifyForm = document.querySelector('[data-auth-step="verify"]');
  const authStatus = document.querySelector('[data-auth-status]');
  if (requestForm) {
    requestForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(requestForm);
      const widgetToken = data.get('cf-turnstile-response') || (window.turnstile?.getResponse?.() || '');
      showStatus(authStatus, 'Sending your six-digit code…');
      try {
        const result = await postJSON('/internal/auth/request-otp', {
          email: data.get('email'),
          displayName: data.get('displayName'),
          newsletterOptIn: false,
          turnstileToken: widgetToken,
        });
        challengeId = result.challengeId;
        requestForm.hidden = true;
        verifyForm.hidden = false;
        verifyForm.querySelector('input').focus();
        showStatus(authStatus, 'Check your email for a six-digit code.');
      } catch (error) {
        showStatus(authStatus, friendly(error), true);
        window.turnstile?.reset?.();
      }
    });
  }

  if (verifyForm) {
    verifyForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      showStatus(authStatus, 'Verifying…');
      try {
        await postJSON('/internal/auth/verify-otp', {
          challengeId,
          otp: new FormData(verifyForm).get('otp'),
        });
        showStatus(authStatus, 'You’re in—loading the conversation…');
        window.location.reload();
      } catch (error) {
        showStatus(authStatus, friendly(error), true);
      }
    });
  }

  document.querySelectorAll('[data-requires-auth="true"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      requireSignIn();
    });
  });

  document.querySelectorAll('[data-community-form="response"]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = form.querySelector('.buzz-form-status');
      analytics('buzz_response_attempt', { kind: 'response' });
      showStatus(status, 'Posting your response…');
      try {
        const result = await postJSON(`/buzz/api/discussions/${form.dataset.discussionId}/responses`, {
          body: new FormData(form).get('body'),
        });
        analytics(result.status === 'published' ? 'buzz_response_published' : 'buzz_response_held', { kind: 'response' });
        showStatus(status, result.message);
        form.reset();
        if (result.status === 'published') window.location.reload();
      } catch (error) {
        showStatus(status, friendly(error), true);
      }
    });
  });

  document.querySelectorAll('[data-action="reply"]').forEach((button) => {
    if (button.dataset.requiresAuth) return;
    button.addEventListener('click', () => {
      const form = button.closest('.buzz-response-content').querySelector('[data-community-form="reply"]');
      form.hidden = false;
      form.querySelector('textarea').focus();
    });
  });

  document.querySelectorAll('[data-action="cancel-reply"]').forEach((button) => {
    button.addEventListener('click', () => { button.closest('form').hidden = true; });
  });

  document.querySelectorAll('[data-community-form="reply"]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const response = form.closest('[data-response-id]');
      const status = form.querySelector('.buzz-form-status');
      analytics('buzz_response_attempt', { kind: 'reply' });
      try {
        const result = await postJSON(`/buzz/api/responses/${response.dataset.responseId}/replies`, {
          body: new FormData(form).get('body'),
        });
        analytics(result.status === 'published' ? 'buzz_reply' : 'buzz_response_held', { kind: 'reply' });
        showStatus(status, result.message);
        form.reset();
        if (result.status === 'published') window.location.reload();
      } catch (error) {
        showStatus(status, friendly(error), true);
      }
    });
  });

  document.querySelectorAll('[data-action="reaction"]:not([data-requires-auth])').forEach((button) => {
    button.addEventListener('click', async () => {
      const response = button.closest('[data-response-id]');
      button.disabled = true;
      try {
        const result = await postJSON(`/buzz/api/responses/${response.dataset.responseId}/reaction`, {});
        const count = button.querySelector('span');
        count.textContent = Math.max(0, Number(count.textContent) + (result.liked ? 1 : -1));
        button.classList.toggle('active', result.liked);
        button.setAttribute('aria-pressed', result.liked ? 'true' : 'false');
        analytics('buzz_reaction', { state: result.liked ? 'added' : 'removed' });
      } catch (error) {
        button.title = friendly(error);
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-community-form="report"]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const response = form.closest('[data-response-id]');
      try {
        await postJSON(`/buzz/api/responses/${response.dataset.responseId}/report`, {
          reason: new FormData(form).get('reason'),
          details: new FormData(form).get('details') || '',
        });
        analytics('buzz_report', { reason: new FormData(form).get('reason') });
        form.innerHTML = '<p class="buzz-report-thanks">Thanks. Florida Buzz will review this.</p>';
      } catch (error) {
        if (error.message === 'authentication_required') return requireSignIn();
        const old = form.querySelector('.buzz-form-status');
        showStatus(old, friendly(error), true);
      }
    });
  });

  document.querySelectorAll('[data-community-form="moderation"]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const response = form.closest('[data-response-id]');
      const status = form.querySelector('.buzz-form-status');
      try {
        await postJSON(`/buzz/api/moderation/responses/${response.dataset.responseId}`, {
          action: event.submitter?.value,
          reason: new FormData(form).get('reason'),
        });
        showStatus(status, 'Action saved to the moderation audit log.');
        setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        showStatus(status, friendly(error), true);
      }
    });
  });

  document.querySelectorAll('[data-community-form="discussion-moderation"]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = form.querySelector('.buzz-form-status');
      try {
        await postJSON(`/buzz/api/moderation/discussions/${form.dataset.discussionId}`, {
          action: event.submitter?.value,
          reason: 'Action from Needs Review',
        });
        showStatus(status, 'Discussion action saved to the audit log.');
        setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        showStatus(status, friendly(error), true);
      }
    });
  });

  document.querySelectorAll('[data-community-form="profile-moderation"]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = form.querySelector('.buzz-form-status');
      try {
        await postJSON(`/buzz/api/moderation/profiles/${form.dataset.profileId}`, {
          action: event.submitter?.value,
          reason: 'Action from Needs Review',
        });
        showStatus(status, 'Account action saved to the audit log.');
        setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        showStatus(status, friendly(error), true);
      }
    });
  });
}());
