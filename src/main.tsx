import { StrictMode, Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[App crash]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: '#f9fafb', fontFamily: 'system-ui, sans-serif', padding: '2rem'
        }}>
          <div style={{ maxWidth: '520px', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', marginBottom: '0.5rem' }}>
              Something went wrong
            </h1>
            <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
              The app encountered an unexpected error. This is often caused by missing
              environment variables in the deployment.
            </p>
            {this.state.message && (
              <pre style={{
                background: '#f3f4f6', borderRadius: '0.5rem', padding: '1rem',
                fontSize: '0.8rem', color: '#374151', textAlign: 'left',
                overflowX: 'auto', marginBottom: '1.5rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
              }}>
                {this.state.message}
              </pre>
            )}
            <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>
              If deployed on Netlify, ensure <code>VITE_SUPABASE_URL</code> and{' '}
              <code>VITE_SUPABASE_ANON_KEY</code> are set under{' '}
              <strong>Site settings → Environment variables</strong>, then trigger a new deploy.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: '1.5rem', padding: '0.5rem 1.5rem', backgroundColor: '#2563eb',
                color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer',
                fontSize: '0.875rem', fontWeight: 600
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
