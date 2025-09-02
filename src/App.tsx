import React, { useState } from 'react';
import { Calculator, Wallet, BarChart3, Eye, LogOut, User, Lock, MessageSquare } from 'lucide-react';
import DCFCalculator from './components/DCFCalculator';
import PortfolioTracker from './components/PortfolioTracker';
import StockWatchlist from './components/StockWatchlist';
import AboutUs from './components/AboutUs';
import ContactUs from './components/ContactUs';
import AuthForm from './components/AuthForm';
import ChangePasswordForm from './components/ChangePasswordForm';
import { useAuth } from './hooks/useAuth';
import { supabase } from './lib/supabase';

function App() {
  const { user, loading: authLoading, error: authError, signIn, signUp, signOut, resetPassword, updatePassword } = useAuth();
  const [activeTab, setActiveTab] = useState<'watchlist' | 'dcf' | 'portfolio' | 'about' | 'contact'>('watchlist');
  const [authFormLoading, setAuthFormLoading] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  const handleLogin = async (email: string, password: string) => {
    setAuthFormLoading(true);
    try {
      await signIn(email, password);
    } catch (error) {
      // Error is handled by useAuth hook
    } finally {
      setAuthFormLoading(false);
    }
  };

  const handleSignUp = async (email: string, password: string, username: string) => {
    setAuthFormLoading(true);
    try {
      await signUp(email, password, username);
    } catch (error) {
      // Error is handled by useAuth hook
    } finally {
      setAuthFormLoading(false);
    }
  };

  const handleForgotPassword = async (email: string) => {
    setAuthFormLoading(true);
    try {
      await resetPassword(email);
    } catch (error) {
      // Error is handled by useAuth hook
    } finally {
      setAuthFormLoading(false);
    }
  };

  const handleChangePassword = async (newPassword: string) => {
    try {
      await updatePassword(newPassword);
      setShowChangePassword(false);
    } catch (error) {
      // Error is handled by useAuth hook
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const tabs = [
    { id: 'watchlist', label: 'Stock Watchlist', icon: Eye },
    { id: 'dcf', label: 'DCF Valuation', icon: Calculator },
    { id: 'portfolio', label: 'Portfolio Tracker', icon: Wallet },
    { id: 'about', label: 'About Us', icon: User },
    { id: 'contact', label: 'Contact', icon: MessageSquare }
  ];

  const handleSaveStock = async (stockData: any) => {
    try {
      // Check if stock already exists in watchlist
      const { data: existingStock, error: checkError } = await supabase
        .from('saved_stocks')
        .select('id, ticker')
        .eq('ticker', stockData.ticker)
        .eq('user_email', user?.email)
        .limit(1);

      if (checkError) throw checkError;

      if (existingStock && existingStock.length > 0) {
        alert(`${stockData.ticker} already exists in your watchlist. Please edit it from the Stock Watchlist tab instead of adding a duplicate.`);
        return;
      }

      // Check watchlist limit before saving
      const { data: existingStocks, error: countError } = await supabase
        .from('saved_stocks')
        .select('id', { count: 'exact' })
        .eq('user_email', user?.email);

      if (countError) throw countError;

      const currentCount = existingStocks?.length || 0;
      const WATCHLIST_LIMIT = 500;

      // Check if adding new stock would exceed limit
      if (currentCount >= WATCHLIST_LIMIT) {
        alert(`You've reached the maximum limit of ${WATCHLIST_LIMIT} stocks in your watchlist. Please remove some stocks before adding new ones.`);
        return;
      }

      // Insert new stock
      const { error } = await supabase
        .from('saved_stocks')
        .insert([{
          ticker: stockData.ticker,
          current_price: stockData.currentPrice,
          fair_value: stockData.fairValue,
          expected_return: stockData.expectedReturn,
          cagr: stockData.cagr,
          buy_target: stockData.buyTarget,
          dcf_inputs: stockData.dcfInputs,
          notes: stockData.notes,
          user_email: user?.email
        }]);

      if (error) throw error;
      
      // Switch to watchlist tab to show the saved stock
      setActiveTab('watchlist');
    } catch (error) {
      console.error('Error saving stock:', error);
    }
  };

  // Show loading spinner while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Show auth form if not logged in
  if (!user) {
    return (
      <AuthForm
        onLogin={handleLogin}
        onSignUp={handleSignUp}
        onForgotPassword={handleForgotPassword}
        loading={authFormLoading}
        error={authError}
      />
    );
  }

  // Show change password form if requested
  if (showChangePassword) {
    return (
      <ChangePasswordForm
        onChangePassword={handleChangePassword}
        onCancel={() => setShowChangePassword(false)}
        loading={authLoading}
        error={authError}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">StockValuation Pro</h1>
                <p className="text-sm text-gray-500">DCF Analysis & Portfolio Tracking</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <User className="w-4 h-4" />
                <span>{user.user_metadata?.username || user.email}</span>
              </div>
              <button
                onClick={() => setShowChangePassword(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Lock className="w-4 h-4" />
                Change Password
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'watchlist' && <StockWatchlist />}
        {activeTab === 'dcf' && <DCFCalculator onSaveStock={handleSaveStock} />}
        {activeTab === 'portfolio' && <PortfolioTracker />}
        {activeTab === 'about' && <AboutUs />}
        {activeTab === 'contact' && <ContactUs />}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-sm text-gray-500">
            <p>Professional DCF valuation calculator with portfolio tracking</p>
            <p className="mt-1">Built with React, TypeScript, Tailwind CSS, and Supabase</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;