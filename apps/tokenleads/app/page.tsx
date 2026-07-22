import { redirect } from 'next/navigation';

// No landing page yet — the app IS the dashboard. Middleware bounces
// unauthenticated visitors to /login before this ever runs.
export default function Root() {
  redirect('/dashboard');
}
