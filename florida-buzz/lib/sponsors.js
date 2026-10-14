/**
 * Florida Buzz sponsors — curated partner listings for /sponsors.
 * Keep this list short and real; an empty logo wall looks worse than one
 * featured partner with a clear "become a sponsor" path.
 */

const SPONSORS = [
  {
    id: 'rook-careers',
    name: 'Rook Careers',
    featured: true,
    tagline: 'Florida-minded careers, without the noise',
    description:
      'Rook Careers helps job seekers find roles that fit — with a focus on clear listings, practical guidance, and less résumé roulette. Proud to support Florida Buzz as our first partner.',
    url: 'https://rookcareers.com',
    logoUrl: '/images/sponsors/rook-careers.png',
    logoAlt: 'Rook Careers logo',
    ctaLabel: 'Visit Rook Careers',
  },
];

function sponsorsConfig() {
  const featured = SPONSORS.filter((s) => s.featured);
  const partners = SPONSORS.filter((s) => !s.featured);
  return {
    sponsors: SPONSORS,
    featured,
    partners,
    inquireEmail: 'floridabuzzonline@gmail.com',
  };
}

module.exports = {
  SPONSORS,
  sponsorsConfig,
};
