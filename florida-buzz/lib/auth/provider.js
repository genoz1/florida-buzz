const { createClient } = require('@supabase/supabase-js');

function createSupabaseOtpProvider({ url, anonKey }) {
  if (!url || !anonKey) throw new Error('Supabase URL and anonymous key are required for reader authentication.');
  const client = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return {
    async requestOtp(email) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (error) throw new Error('OTP provider rejected the request.');
    },

    async verifyOtp(email, token) {
      const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
      if (error || !data?.user || !data?.session) return null;
      return { user: data.user, session: data.session };
    },

    async refreshSession(refreshToken) {
      const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data?.session || !data?.user) return null;
      return { user: data.user, session: data.session };
    },
  };
}

module.exports = { createSupabaseOtpProvider };
