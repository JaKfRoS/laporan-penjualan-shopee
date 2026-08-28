import React from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`ErrorBoundary${this.props.label ? ` (${this.props.label})` : ''} caught an error:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-6 py-10">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-500/10 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-lg font-black uppercase tracking-tight mb-2 dark:text-white">
            Terjadi Kesalahan {this.props.label ? `saat Menampilkan ${this.props.label}` : ''}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mb-6 font-medium">
            {this.state.error.message || 'Data yang ditampilkan menyebabkan error yang tidak terduga. Coba muat ulang halaman.'}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-6 py-3 bg-orange-600 text-white rounded-xl font-black text-sm flex items-center gap-2 hover:bg-orange-700 transition-all"
          >
            <RefreshCcw className="w-4 h-4" />
            COBA LAGI
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
