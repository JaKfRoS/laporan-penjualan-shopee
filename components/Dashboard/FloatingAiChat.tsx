
import React, { useEffect, useRef, useState } from 'react';
import { Bot, MessageCircle, Minus, X, Send, Loader2, AlertCircle } from 'lucide-react';
import { AiSettings } from '../../types';
import { chatWithAssistant, AiNotConfiguredError, ChatMessage, humanizeAiError } from '../../services/aiInsights';
import { InsightBody } from './InsightMarkdown';

interface FloatingAiChatProps {
  visible: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
  storeName: string;
  contextSummary: string;
  aiSettings: AiSettings | null;
}

// Floating AI Chat Assistant - kelanjutan diskusi dari kartu "ShopeeSales AI
// Agent" di Dashboard. `visible` = bubble ada di layar (mulai dari klik
// "Ajukan Pertanyaan" sampai user menutup penuh lewat X di header), `open` =
// jendela chat sedang terbuka (diminimalkan lewat header cuma balik jadi
// bubble kecil, sesi & riwayat chat tetap tersimpan).
export const FloatingAiChat: React.FC<FloatingAiChatProps> = ({ visible, open, onOpenChange, onClose, storeName, contextSummary, aiSettings }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sesi baru tiap kali bubble dimunculkan (bukan tiap minimize/restore) -
  // efek ini cuma nyala saat `visible` beneran berubah dari false -> true.
  useEffect(() => {
    if (visible) {
      setMessages([{
        role: 'assistant',
        content: `Halo! Saya AI Assistant ShopeeSales. Saya sudah membaca hasil analisis toko ${storeName.toUpperCase()}. Ada yang ingin kamu diskusikan mengenai potongan marketplace, iklan, atau strategi bundling tadi?`,
      }]);
      setInput('');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!visible) return null;

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const reply = await chatWithAssistant(nextMessages, contextSummary, aiSettings);
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      setError(err instanceof AiNotConfiguredError ? 'AI belum diatur - buka Pengaturan → Integrasi AI.' : humanizeAiError(err));
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => onOpenChange(true)}
        // bottom-24 di mobile: bar navigasi bawah App.tsx (z-[100], fixed
        // bottom-0) menutupi apapun yang ditaruh persis di bottom-6 di layar
        // HP - digeser ke atas biar bubble tidak ketutupan/nempel. Di md+
        // bar navigasi itu tidak ada (md:hidden), jadi balik ke bottom-6.
        className="fixed z-[110] bottom-24 right-5 md:bottom-6 md:right-6 w-14 h-14 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-2xl shadow-purple-500/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform animate-in zoom-in duration-300"
        title="Buka AI Assistant"
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div
      // z-[110]: harus di atas bar navigasi bawah mobile (z-[100] di
      // App.tsx) supaya jendela chat (termasuk input di paling bawah) tidak
      // ketutupan/ketimpa nav saat dibuka fullscreen di HP - perilaku modal
      // fullscreen yang wajar, nav memang seharusnya tidak bisa dipakai
      // selagi chat terbuka.
      className="fixed z-[110] bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800
        inset-x-0 bottom-0 h-[85dvh] rounded-t-3xl animate-in slide-in-from-bottom duration-300
        md:inset-x-auto md:inset-y-auto md:bottom-6 md:right-6 md:w-[380px] md:h-[520px] md:rounded-3xl md:slide-in-from-bottom-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-wide truncate">AI Assistant ShopeeSales</p>
            <p className="text-[10px] text-purple-100 truncate">Toko {storeName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onOpenChange(false)} className="p-1.5 hover:bg-white/15 rounded-lg transition-colors" title="Minimalkan">
            <Minus className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="p-1.5 hover:bg-white/15 rounded-lg transition-colors" title="Tutup">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 custom-scrollbar">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[82%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-purple-600 text-white rounded-br-md'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-bl-md'
              }`}
            >
              {m.role === 'assistant' ? <InsightBody text={m.content} /> : <span className="whitespace-pre-line">{m.content}</span>}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-medium px-3 py-2.5 rounded-xl">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="flex items-center gap-2 p-3 border-t border-slate-100 dark:border-slate-800 shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Tanyakan sesuatu..."
          disabled={sending}
          className="flex-1 min-w-0 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-full text-sm outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="w-10 h-10 shrink-0 rounded-full bg-purple-600 text-white flex items-center justify-center hover:bg-purple-700 transition-colors disabled:opacity-40"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
};
