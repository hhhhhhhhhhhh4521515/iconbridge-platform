import { DESTINATION_CODES, DESTINATION_LABELS } from '@iconbridge/shared';
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-24 text-center">
      <p className="text-muted-foreground text-sm font-medium tracking-widest uppercase">
        Coming soon
      </p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">IconBridge Jobs</h1>
      <p className="text-muted-foreground max-w-xl text-lg">
        Apply for jobs in Malta, Poland and on cruise ships. The platform is under construction.
      </p>
      <ul className="flex flex-wrap justify-center gap-3">
        {DESTINATION_CODES.map((code) => (
          <li key={code} className="rounded-full border px-4 py-1.5 text-sm font-medium">
            {DESTINATION_LABELS[code]}
          </li>
        ))}
      </ul>
      <Button asChild variant="outline">
        <a href={`${env.NEXT_PUBLIC_API_URL}/api/docs`}>API documentation</a>
      </Button>
    </main>
  );
}
