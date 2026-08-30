import ChatClient from './ChatClient';
import { getSuggestedQuestions } from '@/app/lib/suggestions';

export const dynamic = 'force-dynamic';

export default async function AskTheRecordPage() {
  const suggestions = await getSuggestedQuestions();

  return (
    <main className="max-w-3xl mx-auto px-9 py-12">
      <ChatClient suggestions={suggestions} />
    </main>
  );
}
