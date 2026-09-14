
import React from 'react';

// Render ringan ala-Markdown buat balasan AI (kartu insight & chat assistant):
// "- poin" jadi list ber-bullet, **teks** jadi tebal. Model biasanya balas
// dalam format ini karena diminta lewat system instruction, tapi tetap
// fallback aman ke paragraf biasa kalau tidak ada listnya sama sekali.
const renderBoldSegments = (line: string, keyPrefix: string) => {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={`${keyPrefix}-${i}`} className="font-black text-slate-900 dark:text-white">{part.slice(2, -2)}</strong>
    ) : (
      <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>
    )
  );
};

export const InsightBody: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const isBullet = (l: string) => /^([-*•]|\d+[.)])\s+/.test(l);

  if (!lines.some(isBullet)) {
    return <p className="whitespace-pre-line">{renderBoldSegments(text, 'p')}</p>;
  }

  return (
    <div className="space-y-2.5">
      {lines.map((line, idx) => {
        if (isBullet(line)) {
          const content = line.replace(/^([-*•]|\d+[.)])\s+/, '');
          return (
            <div key={idx} className="flex items-start gap-2.5">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
              <span>{renderBoldSegments(content, `b${idx}`)}</span>
            </div>
          );
        }
        return <p key={idx}>{renderBoldSegments(line, `p${idx}`)}</p>;
      })}
    </div>
  );
};
