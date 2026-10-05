import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

/** Renders a private image that requires the user's bearer token (plain <img src> cannot send it). */
export function AuthImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const { data, isError } = useQuery({ queryKey: ['blob', src], queryFn: () => api.blob(src), staleTime: Infinity });
  const [url, setUrl] = useState<string | null>(null);

  // Create and revoke the object URL in the same effect so each mount owns its own URL.
  useEffect(() => {
    if (!data) return;
    const objectUrl = URL.createObjectURL(data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [data]);

  if (isError) return <div className={`flex items-center justify-center bg-slate-100 text-xs text-slate-500 ${className}`}>Failed to load</div>;
  if (!url) return <div className={`animate-pulse bg-slate-100 ${className}`} />;
  return <img src={url} alt={alt} className={className} />;
}
