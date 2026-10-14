import { Landing } from '@/components/landing/Landing';

/** The public landing page. Logged-out visitors see it at every URL; this route keeps it reachable after sign-in. */
export default function Welcome() {
  return <Landing />;
}
