'use strict';

const GUIDE_PAGE_SIZE = 50;

function createGuidesArchiveHandler({ getArticles, render404, render503, isUpstreamError, viewLocals = {} }) {
  return async function renderGuidesArchive(req, res, next) {
    const raw = String(req.params.page || req.query.page || '1');
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      return render404(req, res, { routeType: 'guides' });
    }
    const page = Number(raw);
    const canonicalPath = page === 1 ? '/guides' : '/guides/page/' + page;
    if ((req.params.page && page === 1) || req.query.page !== undefined) {
      return res.redirect(301, canonicalPath);
    }
    try {
      // Unbounded queries read every database batch and remove redirect aliases.
      const all = await getArticles({ evergreenOnly: true });
      all.sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || ''))
        || String(a.slug).localeCompare(String(b.slug)));
      const totalPages = Math.max(1, Math.ceil(all.length / GUIDE_PAGE_SIZE));
      if (page > totalPages) return render404(req, res, { routeType: 'guides' });
      const ticker = await getArticles({ limit: 8 });
      return res.render('guides', {
        ...viewLocals,
        guides: all.slice((page - 1) * GUIDE_PAGE_SIZE, page * GUIDE_PAGE_SIZE),
        ticker,
        canonicalPath,
        pagination: {
          page, totalPages, total: all.length,
          prevHref: page === 1 ? null : page === 2 ? '/guides' : '/guides/page/' + (page - 1),
          nextHref: page === totalPages ? null : '/guides/page/' + (page + 1),
        },
      });
    } catch (err) {
      if (isUpstreamError(err)) return render503(req, res, { routeType: 'guides', error: err });
      return next(err);
    }
  };
}
module.exports = { GUIDE_PAGE_SIZE, createGuidesArchiveHandler };
