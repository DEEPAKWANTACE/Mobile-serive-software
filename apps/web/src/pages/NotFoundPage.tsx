import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="text-brand-600 hover:underline">Go to dashboard</Link>
    </div>
  );
}
