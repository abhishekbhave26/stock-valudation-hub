import React from 'react';
import { BarChart3, User, ExternalLink, TrendingUp, Calculator, Wallet, Shield, Zap, Target } from 'lucide-react';

export default function AboutUs() {
  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-2xl p-8">
        <div className="flex items-center gap-4 mb-6">
          <div className="p-3 bg-blue-600 rounded-xl">
            <BarChart3 className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">About StockValuation Pro</h1>
            <p className="text-lg text-gray-600">Professional DCF Analysis & Portfolio Tracking</p>
          </div>
        </div>
        
        <p className="text-lg text-gray-700 leading-relaxed">
          StockValuation Pro is a comprehensive investment analysis platform designed for serious investors 
          who believe in fundamental analysis and data-driven decision making. Our mission is to democratize 
          professional-grade valuation tools and make sophisticated investment analysis accessible to everyone.
        </p>
      </div>

      {/* What We Offer */}
      <div className="bg-white rounded-xl shadow-lg p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">What We Offer</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center p-6 bg-blue-50 rounded-xl">
            <Calculator className="w-12 h-12 text-blue-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">DCF Valuation Calculator</h3>
            <p className="text-gray-600 text-sm">
              Professional-grade DCF analysis with customizable growth projections, 
              multiple valuation metrics, and comprehensive fair value calculations.
            </p>
          </div>
          
          <div className="text-center p-6 bg-green-50 rounded-xl">
            <TrendingUp className="w-12 h-12 text-green-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Stock Watchlist</h3>
            <p className="text-gray-600 text-sm">
              Track up to 200 analyzed stocks with real-time price updates, 
              valuation status indicators, and smart buy/sell recommendations.
            </p>
          </div>
          
          <div className="text-center p-6 bg-purple-50 rounded-xl">
            <Wallet className="w-12 h-12 text-purple-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Portfolio Tracker</h3>
            <p className="text-gray-600 text-sm">
              Monitor your investments with detailed performance metrics, 
              CAGR calculations, and visual portfolio allocation charts.
            </p>
          </div>
        </div>
      </div>

      {/* Key Features */}
      <div className="bg-white rounded-xl shadow-lg p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Key Features</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Shield className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Secure & Private</h3>
              <p className="text-gray-600 text-sm">Your data is protected with enterprise-grade security and user authentication.</p>
            </div>
          </div>
          
          <div className="flex items-start gap-4">
            <div className="p-2 bg-green-100 rounded-lg">
              <Zap className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Real-time Data</h3>
              <p className="text-gray-600 text-sm">Live stock prices and automatic updates keep your analysis current.</p>
            </div>
          </div>
          
          <div className="flex items-start gap-4">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Target className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Professional Analysis</h3>
              <p className="text-gray-600 text-sm">Industry-standard DCF methodology with customizable parameters.</p>
            </div>
          </div>
          
          <div className="flex items-start gap-4">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <BarChart3 className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Visual Insights</h3>
              <p className="text-gray-600 text-sm">Interactive charts and graphs make complex data easy to understand.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Creator Section */}
      <div className="bg-white rounded-xl shadow-lg p-8">
        <div className="flex items-center gap-4 mb-6">
          <div className="p-3 bg-gray-100 rounded-xl">
            <User className="w-8 h-8 text-gray-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Meet the Creator</h2>
            <p className="text-gray-600">The mind behind StockValuation Pro</p>
          </div>
        </div>
        
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6">
          <h3 className="text-xl font-bold text-gray-900 mb-3">Abhishek Bhave</h3>
          <p className="text-gray-700 mb-4 leading-relaxed">
            Abhishek Bhave is a passionate software developer and investor who created StockValuation Pro 
            to bridge the gap between professional investment analysis and retail investors. With a deep 
            understanding of both technology and finance, Abhishek believes that everyone should have 
            access to the same analytical tools used by professional fund managers and analysts.
          </p>
          
          <p className="text-gray-700 mb-6 leading-relaxed">
            Driven by the philosophy that informed investing leads to better outcomes, Abhishek built 
            this platform to help investors make data-driven decisions based on fundamental analysis 
            rather than speculation or market sentiment.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4">
            <a
              href="https://www.linkedin.com/in/abhishekbhave26/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              LinkedIn Profile
            </a>
            
            <a
              href="https://abhishekbhave26.github.io/Portfolio-Website/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Portfolio Website
            </a>
          </div>
        </div>
      </div>

      {/* Mission Statement */}
      <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Our Mission</h2>
        <p className="text-lg text-gray-700 leading-relaxed">
          To empower individual investors with professional-grade analysis tools, enabling them to make 
          informed investment decisions based on fundamental analysis and intrinsic value calculations. 
          We believe that with the right tools and knowledge, every investor can achieve their financial goals 
          through disciplined, value-oriented investing.
        </p>
      </div>
    </div>
  );
}