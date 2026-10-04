(function () {
  'use strict';

  const module = document.querySelector('[data-article-buzz-module]');
  if (!module) return;

  function analytics(event) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, surface: 'article' });
  }

  let viewed = false;
  const recordImpression = () => {
    if (viewed) return;
    viewed = true;
    analytics('article_buzz_module_impression');
  };

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        recordImpression();
        observer.disconnect();
      }
    }, { threshold: 0.35 });
    observer.observe(module);
  } else {
    recordImpression();
  }

  module.querySelector('[data-article-buzz-cta]')?.addEventListener('click', () => {
    analytics('article_buzz_join_click');
  });
}());
