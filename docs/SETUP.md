# Setup Guide

## Stage 1: Auth + Allowlist Gate

### Prerequisites

1. **Supabase CLI** installed and initialized
2. **Node.js** and npm installed
3. **Environment variables** configured

### Environment Variables

Create a `.env.local` file in the root directory with:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

To get your anon key, run `supabase status` after starting Supabase locally.

### Database Setup

1. **Start Supabase locally:**
   ```bash
   supabase start
   ```

2. **Run migrations:**

   There are several ways to apply migrations:

   **Option A: Reset database (recommended for first-time setup)**
   ```bash
   supabase db reset
   ```
   This will:
   - Drop all existing data
   - Run all migrations from scratch
   - Run seed files (if any)
   - Perfect for a fresh start

   **Option B: Apply pending migrations (preserves data)**
   ```bash
   supabase migration up
   ```
   This will:
   - Only apply migrations that haven't been run yet
   - Preserves existing data
   - Use this when you've added new migrations

   **Option C: Push migrations (alternative)**
   ```bash
   supabase db push
   ```
   This pushes local migrations to the database.

   For the initial setup, use `supabase db reset` to create the `allowed_users` table with RLS policies.

### Google OAuth Configuration

For **local development**, you need to configure Google OAuth in the `supabase/config.toml` file:

1. Open `supabase/config.toml`
2. Find the `[auth.external.google]` section (it's been added to the config file)
3. Update it with your Google OAuth credentials:

```toml
[auth.external.google]
enabled = true
client_id = "your-google-client-id.apps.googleusercontent.com"
# DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead:
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
redirect_uri = ""
url = ""
# If enabled, the nonce check will be skipped. Required for local sign in with Google auth.
skip_nonce_check = true
email_optional = false
```

4. Add the secret to your environment:
   - **Option A (Recommended)**: Create a `.env` file in the `supabase` directory:
     ```
     SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=your-google-client-secret
     ```
   - **Option B**: Set it as a system environment variable before running `supabase start`
   - **Option C (Temporary)**: You can hardcode it directly in `config.toml` for local dev only (but **don't commit it!**)

5. Restart Supabase: 
   ```bash
   supabase stop
   supabase start
   ```

#### Getting Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable **Google+ API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Configure:
   - Application type: **Web application**
   - Authorized redirect URIs: `http://127.0.0.1:54321/auth/v1/callback`
6. Copy the **Client ID** and **Client Secret**

### Adding Users to Allowlist

You can **pre-approve users by email** before they sign in! The `auth_user_id` is optional and will be automatically linked when the user signs in.

#### Add a user by email (simple):

1. Open Supabase Studio: `http://127.0.0.1:54323`
2. Go to **SQL Editor**
3. Run this SQL:

```sql
-- Pre-approve a user by email (before they sign in)
INSERT INTO public.allowed_users (email)
VALUES ('user@example.com');
```

That's it! When the user signs in with that email, they'll automatically have access. The `auth_user_id` will be linked automatically via a database trigger.

#### Add multiple users at once:

```sql
INSERT INTO public.allowed_users (email) VALUES
  ('user1@example.com'),
  ('user2@example.com'),
  ('user3@example.com');
```

#### Verify users were added:

- Go to **Table Editor** → `allowed_users`
- You should see entries with `email` filled in (and `auth_user_id` will be NULL until they sign in)

**Note:** The RLS policies prevent direct inserts through the Table Editor UI, so you must use the SQL Editor which runs with service role privileges.

### Testing

1. Start the Next.js dev server:
   ```bash
   npm run dev
   ```

2. Navigate to `http://127.0.0.1:3000`
3. You should be redirected to `/login`
4. Click "Sign in with Google"
5. After signing in:
   - If you're **not** in the allowlist → redirected to `/access-denied`
   - If you're **in** the allowlist → redirected to `/health`

### Exit Criteria

✅ Only allowlisted users can access app pages  
✅ Non-allowed users see access denied screen  
✅ Google OAuth login works  
✅ Logout functionality works  
✅ User info displayed in top nav
