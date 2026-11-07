'use strict';

/**
 * Public Florida Buzz social profiles used by the publishing stack.
 * Keep these as canonical https URLs (no UTM) for footer / schema sameAs.
 */
const SOCIAL_PROFILES = [
  {
    id: 'facebook',
    label: 'Facebook',
    href: 'https://www.facebook.com/thefloridabuzz',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    href: 'https://www.instagram.com/thefloridabuzz/',
  },
  {
    id: 'threads',
    label: 'Threads',
    href: 'https://www.threads.net/@thefloridabuzz',
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    href: 'https://www.pinterest.com/thefloridabuzz/',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    href: 'https://www.youtube.com/@TheFloridaBuzz',
  },
];

function socialProfileUrls() {
  return SOCIAL_PROFILES.map((p) => p.href);
}

module.exports = {
  SOCIAL_PROFILES,
  socialProfileUrls,
};
