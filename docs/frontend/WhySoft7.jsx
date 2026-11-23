import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring } from 'framer-motion';
import {
  FaWhatsapp, FaCheckCircle, FaTimes, FaGift, FaStar, FaRocket,
  FaChevronDown, FaPhoneAlt, FaEnvelope, FaArrowRight, FaBuilding,
  FaGraduationCap, FaHospital, FaShoppingCart, FaDollarSign, FaPlane,
  FaShieldAlt, FaBullhorn, FaRobot, FaChartBar, FaLink, FaBell,
  FaUsers, FaHeadset, FaChartLine, FaHourglassHalf,
  FaAd, FaLock, FaSearch
} from 'react-icons/fa';
import { toast } from 'react-toastify';

import styles from './WhySoft7.module.css';
import Footer from '../../Components/Footer/Footer';

// This URL uses the same origin as the page. Use an absolute URL if the API is on another host.
const LEAD_API_URL = '/api/why-soft7-leads';


// Animation variants
const fadeInUp = {
  hidden: { opacity: 0, y: 35 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }
};

const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.6 } }
};

const staggerContainer = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1
    }
  }
 };

const slideInLeft = {
  hidden: { opacity: 0, x: -40 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } }
};

const slideInRight = {
  hidden: { opacity: 0, x: 40 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } }
};

const cardHover = {
  hover: {
    y: -8,
    boxShadow: "0 20px 40px rgba(37, 211, 102, 0.08)",
    borderColor: "rgba(37, 211, 102, 0.35)",
    transition: { duration: 0.3, ease: "easeOut" }
  }
};

const industriesData = [
  { id: 'real-estate', icon: <FaBuilding />, name: 'Real Estate', challenge: 'Slow manual follow-ups lead to buyers losing interest in premium property listings.', solution: 'Send high-res property brochures, photos, and book guided site visits instantly via interactive bots.', outcome: '35% Increase in Site Bookings' },
  { id: 'education', icon: <FaGraduationCap />, name: 'Education', challenge: 'High call drop rates and slow advisor responses when counseling prospective students.', solution: 'Automate FAQ answers, share downloadable course modules, and capture student documents.', outcome: '2.5x Admissions Conversions' },
  { id: 'healthcare', icon: <FaHospital />, name: 'Healthcare', challenge: 'High rates of patient no-shows and time wasted manually managing clinical schedules.', solution: 'Send automated appointment confirmations, preparation reminders, and secure digital lab reports.', outcome: '60% Reduction in No-Shows' },
  { id: 'ecommerce', icon: <FaShoppingCart />, name: 'Ecommerce', challenge: 'Average cart abandonment rates above 70% leaking massive storefront checkout revenues.', solution: 'Trigger automated cart reminders with personalized discount codes and pre-filled checkout links.', outcome: '28% Recovered Cart Revenues' },
  { id: 'finance', icon: <FaDollarSign />, name: 'Finance', challenge: 'Delays in getting customer documents uploaded and verified for loans or accounts.', solution: 'Securely request files, automate KYC status updates, and send monthly account statements.', outcome: '50% Faster Loan Processing' },
  { id: 'travel', icon: <FaPlane />, name: 'Travel & Hospitality', challenge: 'Support teams flooded with repetitive tickets regarding booking confirmations and flight statuses.', solution: 'Auto-deliver boarding passes, hotel check-in details, and real-time flight delay alerts.', outcome: '80% First Contact Resolutions' },
  { id: 'insurance', icon: <FaShieldAlt />, name: 'Insurance', challenge: 'Customers forgetting premium renewals, leading to policy lapse.', solution: 'Send renewal alerts with one-click instant WhatsApp UPI payment checkout links.', outcome: '42% Drop in Renewal Failures' },
  { id: 'marketing', icon: <FaAd />, name: 'Agencies', challenge: 'Campaign leads cooling down rapidly before sales agents can initiate phone calls.', solution: 'Send automated welcome messages within 5 seconds of lead form submission.', outcome: '4x Higher Lead Response Rate' }
];

const challengesData = [
  {
    challenge: 'Low Customer Response Rates',
    challengeDesc: 'Emails get ignored and cold calls are blocked. Only 1-2% of prospects answer standard SMS.',
    solution: 'Automated Follow-Ups',
    solutionDesc: 'Reach customers instantly on WhatsApp where they are active. Achieve up to 98% open rates.'
  },
  {
    challenge: 'Manual WhatsApp messaging load',
    challengeDesc: 'Agents copy-pasting the same message on physical devices limits your business output.',
    solution: 'Bulk Campaigns & Broadcasts',
    solutionDesc: 'Broadcast personalized updates, promo codes, and alerts to unlimited opt-in contacts safely.'
  },
  {
    challenge: 'Zero Support Automation',
    challengeDesc: 'No automated response outside office hours leads to high churn and lost customer interest.',
    solution: '24/7 Chatbot Qualification',
    solutionDesc: 'Instantly address FAQ questions, process queries, and verify contact data without manual delay.'
  },
  {
    challenge: 'Missed Leads & High Wait Times',
    challengeDesc: 'Leads from Facebook/Google vanish when not replied to instantly, impacting ad spend ROI.',
    solution: 'Instant Welcome & Smart Routing',
    solutionDesc: 'Auto-assign incoming conversations to corresponding sales reps based on region or product.'
  },
  {
    challenge: 'Slow Customer Support',
    challengeDesc: 'Traditional tickets require days of back-and-forth email communications, frustrating buyers.',
    solution: 'Multi-Agent Team Collaboration',
    solutionDesc: 'Enable unlimited agents to log in, respond, and collaborate using one central business phone number.'
  },
  {
    challenge: 'No CRM Integration',
    challengeDesc: 'Lead data stays inside silos on agent phones instead of auto-syncing to your master database.',
    solution: 'Seamless CRM Integrations',
    solutionDesc: 'Synchronize conversations, lead statuses, and support requests directly into Zoho, HubSpot, etc.'
  }
];

// Interactive 3D Card Tilt Component
function TiltCard({ children, className, onClick }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // rotation angles calculations
  const rotateX = useTransform(y, [-180, 180], [10, -10]);
  const rotateY = useTransform(x, [-180, 180], [-10, 10]);

  // physics spring settings
  const springConfig = { damping: 22, stiffness: 220, mass: 0.4 };
  const springRotateX = useSpring(rotateX, springConfig);
  const springRotateY = useSpring(rotateY, springConfig);

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left - width / 2;
    const mouseY = e.clientY - rect.top - height / 2;
    x.set(mouseX);
    y.set(mouseY);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      style={{
        rotateX: springRotateX,
        rotateY: springRotateY,
        transformStyle: 'preserve-3d',
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Option 2: Floating background elements for premium depth & micro-interactions
function FloatingParticles() {
  return (
    <div className={styles.floatingContainer}>
      <motion.div
        className={styles.floatingShape + ' ' + styles.shapeRingGreen}
        animate={{
          y: [0, -20, 0],
          rotate: [0, 180, 360],
          scale: [1, 1.05, 1]
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      <motion.div
        className={styles.floatingShape + ' ' + styles.shapeCapsuleBlue}
        animate={{
          y: [0, 25, 0],
          rotate: [0, -90, 0],
          scale: [0.95, 1.05, 0.95]
        }}
        transition={{
          duration: 14,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      <motion.div
        className={styles.floatingShape + ' ' + styles.shapeSphereGreen}
        animate={{
          y: [0, -30, 0],
          x: [0, 15, 0],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      <motion.div
        className={styles.floatingShape + ' ' + styles.shapeGlowBlue}
        animate={{
          scale: [1, 1.15, 1],
          opacity: [0.1, 0.18, 0.1]
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
    </div>
  );
}

// Option A: Interactive Glassmorphic WhatsApp Chat Simulator
function ChatSimulator() {
  const [messages, setMessages] = useState([
    { id: 1, sender: 'bot', text: 'Welcome to SOFT7! 🚀 How can we help you scale today?', timestamp: 'Just now' }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [options, setOptions] = useState([
    { label: '💰 Check Pricing', value: 'pricing' },
    { label: '🔌 CRM Plugins', value: 'crm' },
    { label: '✅ Meta Approval', value: 'approval' },
    { label: '📩 Free RCS Panel', value: 'rcs' }
  ]);
  const chatBodyRef = useRef(null);

  const responses = {
    pricing: {
      text: "Starter: ₹999/mo or ₹7,999/yr (5 agents, visual builder)\n• Growth: ₹2,999/mo (15 agents, smart routing)",
      nextOptions: [
        { label: '🔌 CRM Plugins', value: 'crm' },
        { label: '✅ Meta Approval', value: 'approval' },
        { label: '📝 Reserve Free Setup', value: 'reserve' }
      ]
    },
    crm: {
      text: "We connect Zoho, HubSpot, Salesforce, Shopify, and LeadSquared for free! 🔌",
      nextOptions: [
        { label: '💰 Check Pricing', value: 'pricing' },
        { label: '✅ Meta Approval', value: 'approval' },
        { label: '📝 Reserve Free Setup', value: 'reserve' }
      ]
    },
    approval: {
      text: "Voted official Meta API provider. Green tick verify and approval in under 24h! ⚡",
      nextOptions: [
        { label: '📩 Free RCS Panel', value: 'rcs' },
        { label: '🔌 CRM Plugins', value: 'crm' },
        { label: '📝 Reserve Free Setup', value: 'reserve' }
      ]
    },
    rcs: {
      text: "Unified panel with Free RCS panel to send rich video/carousel SMS to Android. 📱",
      nextOptions: [
        { label: '💰 Check Pricing', value: 'pricing' },
        { label: '✅ Meta Approval', value: 'approval' },
        { label: '📝 Reserve Free Setup', value: 'reserve' }
      ]
    },
    reserve: {
      text: "Fill out the registration form to lock in your free setup! 🎁",
      nextOptions: [
        { label: '↩️ Restart Chat', value: 'restart' }
      ]
    }
  };

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleOptionClick = (option) => {
    const userMsg = { id: Date.now(), sender: 'user', text: option.label, timestamp: 'Just now' };
    setMessages(prev => [...prev, userMsg]);
    setOptions([]);
    setIsTyping(true);

    setTimeout(() => {
      setIsTyping(false);
      
      if (option.value === 'restart') {
        setMessages([
          { id: Date.now(), sender: 'bot', text: 'Hey there! Welcome to SOFT7. 🚀 How can we help you scale your customer conversations today?', timestamp: 'Just now' }
        ]);
        setOptions([
          { label: '💰 Check Pricing', value: 'pricing' },
          { label: '🔌 CRM Plugins', value: 'crm' },
          { label: '✅ Meta Approval', value: 'approval' },
          { label: '📩 Free RCS Panel', value: 'rcs' }
        ]);
        return;
      }

      const res = responses[option.value];
      const botMsg = { id: Date.now() + 1, sender: 'bot', text: res.text, timestamp: 'Just now' };
      setMessages(prev => [...prev, botMsg]);
      setOptions(res.nextOptions);
    }, 750);
  };

  return (
    <div className={styles.chatWindow}>
      {/* WhatsApp Header Mockup */}
      <div className={styles.chatHeader}>
        <div className={styles.chatHeaderAvatar}>S7</div>
        <div className={styles.chatHeaderInfo}>
          <h4>
            SOFT7 Bot <span className={styles.chatVerifiedTick}>✓</span>
          </h4>
          <p>
            <span className={styles.chatOnlineIndicator}></span> Online
          </p>
        </div>
      </div>

      {/* Chat Window Body */}
      <div className={styles.chatBody} ref={chatBodyRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={msg.sender === 'bot' ? styles.msgRowLeft : styles.msgRowRight}>
            <div className={msg.sender === 'bot' ? styles.msgBubbleLeft : styles.msgBubbleRight}>
              {msg.text.split('\n').map((line, i) => (
                <span key={i}>
                  {line}
                  <br />
                </span>
              ))}
              <span className={styles.msgTime}>{msg.timestamp}</span>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className={styles.msgRowLeft}>
            <div className={styles.msgBubbleLeft}>
              <div className={styles.typingDotWrapper}>
                <span className={styles.typingDot}></span>
                <span className={styles.typingDot}></span>
                <span className={styles.typingDot}></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Reply Choices */}
      {options.length > 0 && (
        <div className={styles.chatOptionGrid}>
          {options.map((opt, i) => (
            <button
              key={i}
              className={styles.chatOptionItem}
              onClick={() => handleOptionClick(opt)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WhySoft7() {
  // Exit Intent state
  const [showExitPopup, setShowExitPopup] = useState(false);
  const [hasSeenExitPopup, setHasSeenExitPopup] = useState(false);

  // Accordion, Tabs, DKI & Timer states
  const [openFaq, setOpenFaq] = useState(null);
  const [activeInd, setActiveInd] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [hoveredBar, setHoveredBar] = useState(null);
  const [adKeyword, setAdKeyword] = useState('');
  const [timeLeft, setTimeLeft] = useState(900); // 15 minutes in seconds
  const [expandedTesti, setExpandedTesti] = useState({});
  const [activeFeature, setActiveFeature] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [activeResultCard, setActiveResultCard] = useState(0);

  // Autoplay Use Cases tab rotation
  useEffect(() => {
    if (isHovered && !isMobile) return;
    const interval = setInterval(() => {
      setActiveInd((prev) => (prev + 1) % industriesData.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [isHovered, activeInd, isMobile]);

  // Autoplay business results card on mobile (cycles every 4 seconds)
  useEffect(() => {
    if (!isMobile) return;
    const interval = setInterval(() => {
      setActiveResultCard((prev) => (prev + 1) % 4);
    }, 4000);
    return () => clearInterval(interval);
  }, [isMobile]);

  // Autoplay feature cards expansion on mobile (cycles every 4 seconds)
  useEffect(() => {
    if (!isMobile) return;
    
    // Set initial active card to 0 when entering mobile view so it starts open
    if (activeFeature === null) {
      setActiveFeature(0);
    }
    
    const interval = setInterval(() => {
      setActiveFeature((prev) => {
        if (prev === null || prev >= 9) return 0;
        return prev + 1;
      });
    }, 4000);
    
    return () => clearInterval(interval);
  }, [isMobile, activeFeature]);

  // Handle mobile check for testimonial truncation
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Form states and submission success flags
  const [aboveFoldFormSubmitted, setAboveFoldFormSubmitted] = useState(false);
  const [featuresFormSubmitted, setFeaturesFormSubmitted] = useState(false);
  const [bottomFormSubmitted, setBottomFormSubmitted] = useState(false);
  const [popupFormSubmitted, setPopupFormSubmitted] = useState(false);
  const [submittingForm, setSubmittingForm] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const requestInFlightRef = useRef(false);
  const activeRequestRef = useRef(null);
  const popupCloseTimerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRequestRef.current?.abort();
      if (popupCloseTimerRef.current !== null) clearTimeout(popupCloseTimerRef.current);
    };
  }, []);

  // Controlled form inputs
  const [aboveFoldForm, setAboveFoldForm] = useState({ name: '', phone: '', company: '', volume: '10k-50k' });
  const [featuresForm, setFeaturesForm] = useState({ name: '', phone: '', company: '', volume: '10k-50k' });
  const [bottomForm, setBottomForm] = useState({ name: '', phone: '', company: '', volume: '10k-50k' });
  const [popupForm, setPopupForm] = useState({ name: '', phone: '', company: '', volume: '10k-50k' });

  // 1. Interactive 3D Canvas Particle simulation
  useEffect(() => {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    let width = canvas.width = canvas.parentElement.offsetWidth;
    let height = canvas.height = canvas.parentElement.offsetHeight;

    const handleResize = () => {
      if (canvas.parentElement) {
        width = canvas.width = canvas.parentElement.offsetWidth;
        height = canvas.height = canvas.parentElement.offsetHeight;
      }
    };
    window.addEventListener('resize', handleResize);

    const particles = [];
    const particleCount = 45;

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        radius: Math.random() * 3 + 1,
        color: Math.random() > 0.4 ? 'rgba(37, 211, 102, 0.22)' : 'rgba(59, 130, 246, 0.18)'
      });
    }

    let mouse = { x: null, y: null, radius: 140 };
    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    const handleMouseLeave = () => {
      mouse.x = null;
      mouse.y = null;
    };
    canvas.parentElement.addEventListener('mousemove', handleMouseMove);
    canvas.parentElement.addEventListener('mouseleave', handleMouseLeave);

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      particles.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        if (mouse.x !== null && mouse.y !== null) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < mouse.radius) {
            const force = (mouse.radius - dist) / mouse.radius;
            const angle = Math.atan2(dy, dx);
            p.x -= Math.cos(angle) * force * 1.5;
            p.y -= Math.sin(angle) * force * 1.5;
          }
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        for (let j = idx + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(37, 211, 102, ${0.1 * (1 - dist / 110)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      if (canvas.parentElement) {
        canvas.parentElement.removeEventListener('mousemove', handleMouseMove);
        canvas.parentElement.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, []);

  // 2. DKI extraction & countdown timer
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const term = params.get('utm_term') || params.get('industry') || params.get('keyword');
    if (term) {
      setAdKeyword(decodeURIComponent(term));
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // 3. Welcome / Exit intent popup trigger
  useEffect(() => {
    const seen = sessionStorage.getItem('hasSeenExitPopup');
    if (seen === 'true') {
      setHasSeenExitPopup(true);
      return;
    }

    if (hasSeenExitPopup) return;

    const handleMouseLeave = (e) => {
      if (e.clientY < 50 && !hasSeenExitPopup) {
        setShowExitPopup(true);
        setHasSeenExitPopup(true);
        sessionStorage.setItem('hasSeenExitPopup', 'true');
      }
    };

    document.addEventListener('mouseleave', handleMouseLeave);

    const welcomeTimer = setTimeout(() => {
      if (!hasSeenExitPopup) {
        setShowExitPopup(true);
        setHasSeenExitPopup(true);
        sessionStorage.setItem('hasSeenExitPopup', 'true');
      }
    }, 8000);

    return () => {
      document.removeEventListener('mouseleave', handleMouseLeave);
      clearTimeout(welcomeTimer);
    };
  }, [hasSeenExitPopup]);

  const toggleFaq = (index) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleFormSubmit = async (e, formType) => {
    // Used by both button clicks and form submission (including Enter).
    // Preventing the button's default action avoids a second native submit.
    e.preventDefault();
    if (requestInFlightRef.current) return;

    const formElement = e.currentTarget?.tagName === 'FORM'
      ? e.currentTarget
      : e.currentTarget?.form;
    if (formElement && !formElement.reportValidity()) return;

    const forms = {
      aboveFold: [aboveFoldForm, setAboveFoldFormSubmitted],
      features: [featuresForm, setFeaturesFormSubmitted],
      bottom: [bottomForm, setBottomFormSubmitted],
      popup: [popupForm, setPopupFormSubmitted],
    };
    const config = forms[formType];
    if (!config) return;
    const [form, setSubmitted] = config;
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      company: form.company.trim(),
      volume: form.volume,
      source: formType,
    };
    if (!payload.name || !payload.phone || !payload.company) {
      setFormErrors(previous => ({ ...previous, [formType]: 'Please enter your name, WhatsApp number and company name.' }));
      return;
    }

    requestInFlightRef.current = true;
    setSubmittingForm(formType);
    setFormErrors(previous => ({ ...previous, [formType]: '' }));
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;

    try {
      response = await fetch(LEAD_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* Handled below. */ }
      const serverMessage = [data?.message, data?.error?.message, data?.error, data?.data?.message]
        .find(value => typeof value === 'string' && value.trim());

      if (!response.ok) {
        throw new Error(serverMessage || 'Unable to submit right now. Please try again.');
      }
      // A development server can return the page's HTML with status 200 for a missing API route.
      // Only accept a JSON result, or a successful 204 response with no content.
      if ((text && (!data || typeof data !== 'object' || Array.isArray(data))) || (!text && response.status !== 204)) {
        throw new Error('The server returned an unexpected response. Please try again.');
      }
      if (data?.success === false) {
        throw new Error(serverMessage || 'Your request could not be saved. Please try again.');
      }
      if (!mountedRef.current) return;

      setSubmitted(true);
      if (formType === 'popup') {
        popupCloseTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setShowExitPopup(false);
        }, 3000);
      }
    } catch (error) {
      if (!mountedRef.current) return;
      const message = error?.name === 'AbortError'
        ? 'The request timed out. Please try again.'
        : error?.message || 'Unable to submit right now. Please try again.';
      console.error('Lead submission failed:', {
        endpoint: LEAD_API_URL, source: formType, status: response?.status, message,
      });
      setFormErrors(previous => ({ ...previous, [formType]: message }));
      toast.error(message);
    } finally {
      clearTimeout(timeout);
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
      requestInFlightRef.current = false;
      if (mountedRef.current) setSubmittingForm(null);
    }
  };

  // The green "Get Free WhatsApp API Setup" button submits the hero form.
  const handleGetFreeSetupClick = (event) => handleFormSubmit(event, 'aboveFold');

  const openWhatsappChat = () => {
    window.open('https://wa.me/918605490132?text=Hi%20SOFT7,%20I%20am%20interested%20in%20WhatsApp%20Business%20API%20setup.', '_blank');
  };

  const resultsData = [
    { icon: <FaChartLine />, num: '80%', title: 'Open Rates', desc: 'WhatsApp broadcasts achieve an average open rate of 80%, compared to just 15% for email marketing campaigns.' },
    { icon: <FaHeadset />, num: '5x', title: 'Faster Support', desc: 'Visual chatbot pathways answer FAQs in under 3 seconds, cutting average resolution queues by 80%.' },
    { icon: <FaRocket />, num: '3x', title: 'Lead Conversions', desc: 'Instantly replying to contact form submissions doubles the probability of converting prospects into buyers.' },
    { icon: <FaUsers />, num: '22%', title: 'Higher Retention', desc: 'Providing seamless customer support inside WhatsApp builds deeper consumer trust and loyalty.' }
  ];

  return (
    <div className={styles.page}>
      {/* Option 2: Floating Background Shapes */}
      <FloatingParticles />

      {/* Background Decor */}
      <div className={styles.bgOrb + ' ' + styles.orbGreen}></div>
      <div className={styles.bgOrb + ' ' + styles.orbBlue}></div>

      {/* Exit Intent Popup */}
      <AnimatePresence>
        {showExitPopup && (
          <div className={styles.modalOverlay} onClick={() => setShowExitPopup(false)}>
            <motion.div
              className={styles.modal}
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.9, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 30 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            >
              <button className={styles.modalClose} onClick={() => setShowExitPopup(false)}>
                <FaTimes />
              </button>

              <div className={styles.modalHeader}>
                <motion.div
                  initial={{ rotate: -10, scale: 0.8 }}
                  animate={{ rotate: [0, 10, -10, 0], scale: 1 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                >
                  <img src="/gift_chest_3d.png" className={styles.modalGiftImage} alt="Free Setup Gift Chest" />
                </motion.div>
                <h3>Claim Your Free Setup</h3>
                <p>Register in the next 10 minutes to unlock free WhatsApp API setup worth ₹4,999 + Free RCS panel!</p>
              </div>

              <div className={styles.modalBody}>
                {!popupFormSubmitted ? (
                  <form className={styles.form} onSubmit={(e) => handleFormSubmit(e, 'popup')}>
                    <div className={styles.formGroup}>
                      <label>Full Name</label>
                      <input
                        type="text"
                        required
                        placeholder="John Doe"
                        value={popupForm.name}
                        onChange={(e) => setPopupForm({ ...popupForm, name: e.target.value })}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label>WhatsApp Number</label>
                      <input
                        type="tel"
                        required
                        placeholder="+91 86054 90132"
                        value={popupForm.phone}
                        onChange={(e) => setPopupForm({ ...popupForm, phone: e.target.value })}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label>Company Name</label>
                      <input
                        type="text"
                        required
                        placeholder="Company Pvt Ltd"
                        value={popupForm.company}
                        onChange={(e) => setPopupForm({ ...popupForm, company: e.target.value })}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label>Monthly Volume</label>
                      <div className={styles.selectWrapper}>
                        <select
                          value={popupForm.volume}
                          onChange={(e) => setPopupForm({ ...popupForm, volume: e.target.value })}
                        >
                          <option value="10k-50k">10,000 - 50,000 messages</option>
                          <option value="50k-200k">50,000 - 2,00,000 messages</option>
                          <option value="200k+">More than 2,00,000 messages</option>
                        </select>
                      </div>
                    </div>
                    {formErrors.popup && (
                      <p role="alert" className={styles.formNote} style={{ color: '#b91c1c' }}>
                        {formErrors.popup}
                      </p>
                    )}
                    <motion.button 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="submit" 
                      className={styles.btnPrimary + ' ' + styles.formBtn}
                      onClick={(e) => handleFormSubmit(e, 'popup')}
                      disabled={submittingForm !== null}
                      aria-busy={submittingForm === 'popup'}
                    >
                      {submittingForm === 'popup' ? 'Submitting...' : (
                        <>
                          <FaRocket /> Get Free Setup Now
                        </>
                      )}
                    </motion.button>
                  </form>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={styles.formSuccessState}
                  >
                    <FaCheckCircle className={styles.successIcon} />
                    <h4>Congratulations!</h4>
                    <p>Your free setup reward has been locked. Our onboarding specialist will contact you shortly.</p>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SECTION 1 - Hero with 3D Canvas Background */}
      <section className={styles.heroSection}>
        {/* Interactive 3D Floating Particle Canvas */}
        <canvas id="particle-canvas" className={styles.particleCanvas}></canvas>

        <div className={styles.container}>
          <div className={styles.heroGrid}>
            <div className={styles.heroLeft}>
              <motion.div 
                className={styles.heroHeader}
                initial="hidden"
                animate="visible"
                variants={staggerContainer}
              >
                <motion.div className={styles.heroBadge} variants={fadeInUp}>
                  <FaWhatsapp /> Official API Provider
                </motion.div>
                
                <motion.h1 variants={fadeInUp}>
                  Why {adKeyword ? <span>{adKeyword} Brands</span> : <span>Businesses</span>} Choose SOFT7 for WhatsApp Business API
                </motion.h1>
                
                <motion.p className={styles.heroSubheadline} variants={fadeInUp}>
                  Get Official Meta WhatsApp Business API with Free Setup, Free RCS Panel, Fast Approval, CRM Integration, and Dedicated Indian Support.
                </motion.p>

                <motion.div className={styles.heroTrustGrid} variants={staggerContainer}>
                  {[
                    'Official Meta Cloud API',
                    '1000+ Clients Served',
                    'Free Setup (Save ₹4,999)',
                    'Free RCS Panel Included',
                    'Under 24h Meta Approval',
                    '99.9% Server Uptime'
                  ].map((text, i) => (
                    <motion.div key={i} className={styles.trustBadge} variants={fadeInUp}>
                      <FaCheckCircle className={styles.trustIcon} /> {text}
                    </motion.div>
                  ))}
                </motion.div>
              </motion.div>

              <motion.div 
                className={styles.heroGraphic}
                initial="hidden"
                animate="visible"
                variants={staggerContainer}
              >
                {/* Option A: Interactive Glassmorphic WhatsApp Chat Simulator */}
                <motion.div 
                  className={styles.heroGraphicWrapper}
                  variants={fadeInUp}
                >
                  <ChatSimulator />
                </motion.div>
              </motion.div>
            </div>

            {/* Above the Fold Lead Capture Form */}
            <motion.div 
              className={styles.heroFormBox}
              initial="hidden"
              animate="visible"
              variants={slideInRight}
            >
              <h3>Claim Your Free WhatsApp API Setup</h3>
              <p className={styles.heroFormBoxSub}>Start broadcasting templates to customers in 24 hours.</p>

              {/* Countdown Timer Alert */}
              <div className={styles.timerAlert}>
                <FaHourglassHalf /> Setup Reward Reservation Expires In:{' '}
                <span className={styles.timerNum}>{formatTime(timeLeft)}</span>
              </div>

              {!aboveFoldFormSubmitted ? (
                <form className={styles.form} onSubmit={handleGetFreeSetupClick}>
                  <div className={styles.formGroup}>
                    <label>Full Name</label>
                    <input
                      type="text"
                      required
                      placeholder="John Doe"
                      value={aboveFoldForm.name}
                      onChange={(e) => setAboveFoldForm({ ...aboveFoldForm, name: e.target.value })}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>WhatsApp Number</label>
                    <input
                      type="tel"
                      required
                      placeholder="e.g. +91 86054 90132"
                      value={aboveFoldForm.phone}
                      onChange={(e) => setAboveFoldForm({ ...aboveFoldForm, phone: e.target.value })}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Company Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Acme Corporation"
                      value={aboveFoldForm.company}
                      onChange={(e) => setAboveFoldForm({ ...aboveFoldForm, company: e.target.value })}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Monthly Message Volume</label>
                    <div className={styles.selectWrapper}>
                      <select
                        value={aboveFoldForm.volume}
                        onChange={(e) => setAboveFoldForm({ ...aboveFoldForm, volume: e.target.value })}
                      >
                        <option value="10k-50k">10,000 - 50,000 messages</option>
                        <option value="50k-200k">50,000 - 2,00,000 messages</option>
                        <option value="200k+">More than 2,00,000 messages</option>
                      </select>
                    </div>
                  </div>
                  {formErrors.aboveFold && (
                    <p role="alert" className={styles.formNote} style={{ color: '#b91c1c' }}>
                      {formErrors.aboveFold}
                    </p>
                  )}
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit" 
                    className={styles.btnPrimary + ' ' + styles.formBtn}
                    onClick={handleGetFreeSetupClick}
                    disabled={submittingForm !== null}
                    aria-busy={submittingForm === 'aboveFold'}
                  >
                    {submittingForm === 'aboveFold' ? 'Submitting...' : (
                      <>
                        🚀 Get Free WhatsApp API Setup
                      </>
                    )}
                  </motion.button>
                  <p className={styles.formNote}>Free Setup Worth ₹4,999 Included.</p>
                </form>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={styles.formSuccessState}
                >
                  <FaCheckCircle className={styles.successIcon} />
                  <h4>Setup Package Reserved!</h4>
                  <p>Our API specialist will call you shortly to connect your business phone number.</p>
                </motion.div>
              )}
            </motion.div>
          </div>
        </div>
      </section>

      {/* Grayscale Client Logo Cloud for Instant Social Proof */}
      <section className={styles.logoCloudSection}>
        <div className={styles.container}>
          <div className={styles.logoCloudContainer}>
            <span className={styles.logoCloudTitle}>Trusted by 1000+ Fast-Growing Brands</span>
            <div className={styles.logoGrid}>
              <div className={styles.logoItem}>zomato</div>
              <div className={styles.logoItem}>CRED</div>
              <div className={styles.logoItem}>Paytm</div>
              <div className={styles.logoItem}>lenskart</div>
              <div className={styles.logoItem}>mamaearth</div>
              <div className={styles.logoItem}>boat</div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2 - What Makes SOFT7 Different (With 3D Parallax Card Tilts) */}
      <section className={styles.differentSection}>
        <div className={styles.container}>
          <motion.div 
            className={styles.sectionHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
          >
            <h2>More Than Just a WhatsApp API Provider</h2>
            <p>We provide a premium suite of tools and support engineered to guarantee high customer conversion rates.</p>
          </motion.div>
          <motion.div 
            className={styles.diffGrid}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={staggerContainer}
          >
            {[
              { icon: <FaGift />, title: 'Free Setup Worth ₹4,999', desc: 'Get completely free developer setup assistance. No hidden onboarding fees or starting charges.' },
              { icon: <FaBullhorn />, title: 'Free RCS Messaging Panel', desc: 'Reach Android users with interactive, rich media SMS (RCS) using our unified panel for free.' },
              { icon: <FaCheckCircle />, title: 'Fast Meta Approval Process', desc: 'We work directly with Meta to get your display name and green tick approved in less than 24 hours.' },
              { icon: <FaHeadset />, title: 'Dedicated Indian Support Team', desc: 'Call or text our active support center in India whenever you need API integration or templates help.' },
              { icon: <FaLink />, title: 'CRM Integration Assistance', desc: 'Connect HubSpot, Zoho, Salesforce, LeadSquared, or Shopify directly with our pre-built plugins.' },
              { icon: <FaRobot />, title: 'Custom Chatbot Automation', desc: 'Deploy interactive no-code chatbots to reply to support FAQs and qualify incoming leads 24/7.' },
              { icon: <FaDollarSign />, title: 'Affordable Pricing Plans', desc: 'Pay-as-you-grow plans that scale with your messaging requirements. Best rates on conversation logs.' },
              { icon: <FaLock />, title: 'Official Meta-Compliant Solution', desc: 'Full compliance with WhatsApp Guidelines to avoid number bans. Secure database and encryption standards.' }
            ].map((card, i) => (
              <TiltCard key={i} className={styles.diffCard}>
                <div className={styles.diffIconWrapper}>{card.icon}</div>
                <h3>{card.title}</h3>
                <p>{card.desc}</p>
              </TiltCard>
            ))}
          </motion.div>
        </div>
      </section>

      {/* SECTION 3 - Interactive Problem & Solution Grid Cards */}
      <section className={styles.problemSection}>
        <div className={styles.container}>
          <motion.div 
            className={styles.sectionHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
          >
            <h2>Are You Facing These Challenges?</h2>
            <p>Traditional customer communication channels are broken. See how SOFT7 transitions problems into growth.</p>
          </motion.div>
          
          <motion.div 
            className={styles.probGrid}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={staggerContainer}
          >
            {challengesData.map((item, i) => (
              <React.Fragment key={i}>
                <motion.div 
                  className={styles.challengeCard}
                  variants={fadeInUp}
                  whileHover={{ y: -4 }}
                >
                  <div className={styles.challengeIconWrapper}><FaTimes /></div>
                  <div className={styles.challengeContent}>
                    <h3>{item.challenge}</h3>
                    <p>{item.challengeDesc}</p>
                  </div>
                </motion.div>
                
                <motion.div 
                  className={styles.solutionMatchCard}
                  variants={fadeInUp}
                  whileHover={{ y: -4 }}
                >
                  <div className={styles.solutionIconWrapper}><FaCheckCircle /></div>
                  <div className={styles.solutionContent}>
                    <h3>{item.solution}</h3>
                    <p>{item.solutionDesc}</p>
                  </div>
                </motion.div>
              </React.Fragment>
            ))}
          </motion.div>
        </div>
      </section>

      {/* NEW SECTION - 3D Animated Timeline Onboarding Step Flow */}
      <section className={styles.timelineSection}>
        <div className={styles.container}>
          <motion.div 
            className={styles.sectionHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
          >
            <h2>Get Setup in 3 Simple Steps</h2>
            <p>Our guided developer onboarding gets your first template campaign live in under 24 hours.</p>
          </motion.div>

          <motion.div 
            className={styles.timelineGrid}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
          >
            <motion.div className={styles.timelineStep} variants={fadeInUp}>
              <div className={styles.timelineNode}>
                <FaWhatsapp />
                <span className={styles.timelineNum}>1</span>
              </div>
              <div className={styles.timelineText}>
                <h3>Connect Business Number</h3>
                <p>Link your phone number and verify display name directly with Meta Business Manager in minutes.</p>
              </div>
            </motion.div>

            <motion.div className={styles.timelineStep} variants={fadeInUp}>
              <div className={styles.timelineNode}>
                <FaRobot />
                <span className={styles.timelineNum}>2</span>
              </div>
              <div className={styles.timelineText}>
                <h3>Claim Setup Reward</h3>
                <p>Our support engineers configure pre-built CRM modules, import contacts, and deploy your custom chatbot flow.</p>
              </div>
            </motion.div>

            <motion.div className={styles.timelineStep} variants={fadeInUp}>
              <div className={styles.timelineNode}>
                <FaBullhorn />
                <span className={styles.timelineNum}>3</span>
              </div>
              <div className={styles.timelineText}>
                <h3>Launch Campaigns</h3>
                <p>Compile template updates, send bulk broadcast campaigns, and track open and conversion logs in real-time.</p>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* SECTION 4 - WhatsApp API Features (With 3D Card Tilts) */}
      <section className={styles.featuresSection}>
        <div className={styles.container}>
          <motion.div 
            className={styles.sectionHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
          >
            <h2>WhatsApp API Features Engineered for Growth</h2>
            <p>Everything you need to automate communication, generate leads, and boost user retention.</p>
          </motion.div>
          <motion.div 
            className={styles.featuresGrid}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={staggerContainer}
          >
            {[
              { icon: <FaBullhorn />, title: 'Bulk Messaging', desc: 'Broadcast rich media templates with clickable CTA buttons to thousands of users with smart rate-limiting.' },
              { icon: <FaRobot />, title: 'Chatbot Automation', desc: 'Create visual drag-and-drop conversational paths to resolve queries and book appointments automatically.' },
              { icon: <FaChartBar />, title: 'Campaign Analytics', desc: 'Track delivery, read, and reply rates in real-time. Calculate exact ROI of your broadcast campaigns.' },
              { icon: <FaLink />, title: 'CRM Integration', desc: 'Keep databases updated by linking Zoho, HubSpot, Leadsquared, and Shopify directly into your workflow.' },
              { icon: <FaBell />, title: 'Automated Notifications', desc: 'Trigger instant WhatsApp notifications for order confirmations, shipping updates, and payment links.' },
              { icon: <FaUsers />, title: 'Multi-Agent Team Inbox', desc: 'A collaborative web platform where sales and support reps can manage chats under specific departments.' },
              { icon: <FaLock />, title: 'Official WhatsApp API', desc: 'Direct green tick application support, official display names, and compliance with Meta regulations.' },
              { icon: <FaAd />, title: 'Click-to-WhatsApp Ads', desc: 'Redirect potential buyers from Facebook and Instagram ads straight to a chat flow that captures details.' },
              { icon: <FaSearch />, title: 'Lead Tracking', desc: 'Segment customers automatically based on how they answer your chatbot\'s qualification questions.' },
              { icon: <FaHeadset />, title: 'Support Automation', desc: 'Implement instant ticketing, feedback loops, and customer satisfaction surveys right within WhatsApp.' }
            ].map((feat, i) => {
              const isExpanded = activeFeature === i;
              return (
                <TiltCard 
                  key={i} 
                  className={`${styles.featureCard} ${isExpanded ? styles.featureExpanded : ''}`}
                  onClick={() => setActiveFeature(isExpanded ? null : i)}
                >
                  <div className={styles.featIconWrapper}>{feat.icon}</div>
                  <div className={styles.featText}>
                    <h3>{feat.title}</h3>
                    <p>{feat.desc}</p>
                  </div>
                </TiltCard>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* LEAD FORM AFTER FEATURES */}
      <section className={styles.inlineLeadSection}>
        <div className={styles.container}>
          <motion.div 
            className={styles.leadGrid}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
          >
            <motion.div className={styles.leadInfo} variants={slideInLeft}>
              <h3>Boost Sales Efficiency 10x</h3>
              <p>See why high-growth brands choose SOFT7's visual flow builder and official API connection.</p>
            </motion.div>
            <motion.div variants={slideInRight}>
              {!featuresFormSubmitted ? (
                <form className={styles.leadFormRow} onSubmit={(e) => handleFormSubmit(e, 'features')}>
                  <div className={styles.formGroupInline}>
                    <input
                      type="text"
                      required
                      placeholder="Your Name"
                      className={styles.formInputInline}
                      value={featuresForm.name}
                      onChange={(e) => setFeaturesForm({ ...featuresForm, name: e.target.value })}
                    />
                  </div>
                  <div className={styles.formGroupInline}>
                    <input
                      type="tel"
                      required
                      placeholder="WhatsApp No."
                      className={styles.formInputInline}
                      value={featuresForm.phone}
                      onChange={(e) => setFeaturesForm({ ...featuresForm, phone: e.target.value })}
                    />
                  </div>
                  <div className={styles.formGroupInline}>
                    <input
                      type="text"
                      required
                      placeholder="Company Name"
                      className={styles.formInputInline}
                      value={featuresForm.company}
                      onChange={(e) => setFeaturesForm({ ...featuresForm, company: e.target.value })}
                    />
                  </div>
                  <div className={styles.formGroupInline}>
                    <select
                      className={styles.formSelectInline}
                      value={featuresForm.volume}
                      onChange={(e) => setFeaturesForm({ ...featuresForm, volume: e.target.value })}
                    >
                      <option value="10k-50k">10k - 50k msgs</option>
                      <option value="50k-200k">50k - 200k msgs</option>
                      <option value="200k+">200k+ msgs</option>
                    </select>
                  </div>
                  {formErrors.features && (
                    <p role="alert" className={styles.formNote} style={{ color: '#b91c1c' }}>
                      {formErrors.features}
                    </p>
                  )}
                  <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    type="submit" 
                    className={styles.btnInlineSubmit}
                    onClick={(e) => handleFormSubmit(e, 'features')}
                    disabled={submittingForm !== null}
                    aria-busy={submittingForm === 'features'}
                  >
                    {submittingForm === 'features' ? 'Submitting...' : (
                      <>
                        Claim Free Setup
                      </>
                    )}
                  </motion.button>
                </form>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={styles.formSuccessState}
                >
                  <FaCheckCircle className={styles.successIcon} />
                  <h4>Success! Free Setup Saved</h4>
                  <p>Our executive will help you configure your API workspace today.</p>
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* SECTION 5 - Interactive Industry Selector Tab */}
      <section className={styles.industriesSection}>
        <div 
          className={styles.container}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <motion.div 
            className={styles.sectionHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
          >
            <h2>Tailored Solutions for Every Industry</h2>
            <p>How specific sectors utilize WhatsApp automation to hit high conversion milestones.</p>
          </motion.div>

          <div className={styles.indTabMenu}>
            {industriesData.map((ind, index) => (
              <button
                key={ind.id}
                onClick={() => setActiveInd(index)}
                className={styles.indTabButton + ' ' + (activeInd === index ? styles.indTabButtonActive : '')}
              >
                {ind.name}
                {activeInd === index && (
                  <motion.div 
                    layoutId="indActiveTabCapsule"
                    className={styles.indActiveIndicator}
                    transition={{ type: 'spring', duration: 0.5 }}
                  />
                )}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div 
              key={activeInd}
              className={styles.indTabContentCard}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
            >
              <div className={styles.indContentLeft}>
                <div className={styles.indBigIcon}>
                  {industriesData[activeInd].icon}
                </div>
                <h3>{industriesData[activeInd].name}</h3>
              </div>

              <div className={styles.indContentRight}>
                <div className={styles.indContentBlock}>
                  <h4>⚠️ Industry Challenge</h4>
                  <p>{industriesData[activeInd].challenge}</p>
                </div>
                <div className={styles.indContentBlock}>
                  <h4>🚀 WhatsApp Solution</h4>
                  <p>{industriesData[activeInd].solution}</p>
                </div>
                <div className={styles.indContentBlock}>
                  <h4>📈 Expected Business Outcome</h4>
                  <div className={styles.indOutcomeVal}>
                    <FaCheckCircle /> {industriesData[activeInd].outcome}
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      {/* SECTION 6 - Business Results & Interactive Analytics Tooltips */}
      <section className={styles.resultsSection}>
        <div className={styles.container}>
          <div className={styles.resultsGrid}>
            <motion.div 
              className={styles.resultsContent}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={fadeInUp}
            >
              <div className={styles.sectionHeader} style={{ textAlign: 'left', marginBottom: '2rem' }}>
                <h2>Proven Business Results With WhatsApp API</h2>
                <p>By shifting to chat-based workflows, our partners consistently blow past their old email/SMS KPI records.</p>
              </div>
              {isMobile ? (
                <div className={styles.resultsCarouselWrapper}>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeResultCard}
                      className={styles.resultCard}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.3 }}
                    >
                      <div className={styles.resultCardIcon}>{resultsData[activeResultCard].icon}</div>
                      <h3>{resultsData[activeResultCard].num}</h3>
                      <h4>{resultsData[activeResultCard].title}</h4>
                      <p>{resultsData[activeResultCard].desc}</p>
                    </motion.div>
                  </AnimatePresence>
                  <div className={styles.carouselDots}>
                    {resultsData.map((_, i) => (
                      <button
                        key={i}
                        className={`${styles.carouselDot} ${activeResultCard === i ? styles.activeDot : ''}`}
                        onClick={() => setActiveResultCard(i)}
                        aria-label={`Go to slide ${i + 1}`}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <motion.div className={styles.resultsList} variants={staggerContainer}>
                  {resultsData.map((res, i) => (
                    <motion.div key={i} className={styles.resultCard} variants={fadeInUp}>
                      <div className={styles.resultCardIcon}>{res.icon}</div>
                      <h3>{res.num}</h3>
                      <h4>{res.title}</h4>
                      <p>{res.desc}</p>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </motion.div>

            {/* KPI SVG Chart Display */}
            <motion.div 
              className={styles.analyticsCard}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={slideInRight}
            >
              <div className={styles.analyticsHeader}>
                <div className={styles.analyticsTitle}>
                  <h4>Response Conversion Rates</h4>
                  <p>Hover over the bars to see conversion values</p>
                </div>
                <div className={styles.analyticsLegend}>
                  <div className={styles.legendItem}>
                    <div className={styles.legendColor2}></div> Traditional
                  </div>
                  <div className={styles.legendItem}>
                    <div className={styles.legendColor1}></div> WhatsApp
                  </div>
                </div>
              </div>

              <div className={styles.chartContainer}>
                <div className={styles.chartGridLines}>
                  <div className={styles.chartGridLine}></div>
                  <div className={styles.chartGridLine}></div>
                  <div className={styles.chartGridLine}></div>
                </div>

                <div 
                  className={styles.chartBarGroup}
                  onMouseEnter={() => setHoveredBar('open')}
                  onMouseLeave={() => setHoveredBar(null)}
                >
                  <AnimatePresence>
                    {hoveredBar === 'open' && (
                      <motion.div 
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className={styles.chartTooltip}
                      >
                        <span>WhatsApp: <strong className={styles.chartTooltipVal}>80% Open Rate</strong></span>
                        <span>Traditional: 15% Open Rate</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  
                  <div className={styles.barWrapper}>
                    <motion.div 
                      className={styles.bar + ' ' + styles.bar1} 
                      initial={{ height: 0 }}
                      whileInView={{ height: '15%' }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                    ></motion.div>
                    <motion.div 
                      className={styles.bar + ' ' + styles.bar2} 
                      initial={{ height: 0 }}
                      whileInView={{ height: '80%' }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, ease: 'easeOut', delay: 0.1 }}
                    ></motion.div>
                  </div>
                  <span className={styles.chartLabel}>Open Rates</span>
                </div>

                <div 
                  className={styles.chartBarGroup}
                  onMouseEnter={() => setHoveredBar('click')}
                  onMouseLeave={() => setHoveredBar(null)}
                >
                  <AnimatePresence>
                    {hoveredBar === 'click' && (
                      <motion.div 
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className={styles.chartTooltip}
                      >
                        <span>WhatsApp: <strong className={styles.chartTooltipVal}>55% Click Rate</strong></span>
                        <span>Traditional: 8% Click Rate</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className={styles.barWrapper}>
                    <motion.div 
                      className={styles.bar + ' ' + styles.bar1} 
                      initial={{ height: 0 }}
                      whileInView={{ height: '8%' }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                    ></motion.div>
                    <motion.div 
                      className={styles.bar + ' ' + styles.bar2} 
                      initial={{ height: 0 }}
                      whileInView={{ height: '55%' }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, ease: 'easeOut', delay: 0.1 }}
                    ></motion.div>
                  </div>
                  <span className={styles.chartLabel}>Click Rates</span>
                </div>

                <div 
                  className={styles.chartBarGroup}
                  onMouseEnter={() => setHoveredBar('reply')}
                  onMouseLeave={() => setHoveredBar(null)}
                >
                  <AnimatePresence>
                    {hoveredBar === 'reply' && (
                      <motion.div 
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className={styles.chartTooltip}
                      >
                        <span>WhatsApp: <strong className={styles.chartTooltipVal}>40% Response</strong></span>
                        <span>Traditional: 4% Response</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className={styles.barWrapper}>
                    <motion.div 
                      className={styles.bar + ' ' + styles.bar1} 
                      initial={{ height: 0 }}
                      whileInView={{ height: '4%' }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                    ></motion.div>
                    <motion.div 
                      className={styles.bar + ' ' + styles.bar2} 
                      initial={{ height: 0 }}
                      whileInView={{ height: '40%' }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, ease: 'easeOut', delay: 0.1 }}
                    ></motion.div>
                  </div>
                  <span className={styles.chartLabel}>Response Rates</span>
                </div>
              </div>

              <div className={styles.analyticsMetric}>
                <div className={styles.metricValue}>
                  <motion.div 
                    className={styles.metricNumber}
                    initial={{ scale: 0.5, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                  >
                    98%
                  </motion.div>
                  <div className={styles.metricLabel}>Max Delivery Rate</div>
                </div>
                <div className={styles.metricValue}>
                  <motion.div 
                    className={styles.metricNumber}
                    initial={{ scale: 0.5, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: 0.5 }}
                  >
                    3s
                  </motion.div>
                  <div className={styles.metricLabel}>Average Reply Time</div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* SECTION 7 - Testimonials */}
      <section className={styles.testimonialsSection}>
        <div className={styles.container}>
          <motion.div 
            className={styles.sectionHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
          >
            <h2>Loved by 1000+ Fast-Growing Brands</h2>
            <p>See what founders, support directors, and market managers say about their SOFT7 experience.</p>
          </motion.div>
          <motion.div 
            className={styles.testiGrid}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={staggerContainer}
          >
            {[
              { avatar: 'RK', name: 'Rajesh Kumar', role: 'Founder, UrbanStays Real Estate', quote: 'SOFT7 helped us automate 90% of our customer communication and significantly improved lead conversions. We saved lakhs in call-center salaries.' },
              { avatar: 'SM', name: 'Sneha Mehta', role: 'Ecomm Growth Mgr, GlowSkin Co', quote: 'Our abandoned cart recovery increased by 300% inside 2 weeks of deploying SOFT7\'s automated WhatsApp templates. Essential tool for Shopify stores!' },
              { avatar: 'AM', name: 'Amit Mishra', role: 'Operations Lead, EduPath Academics', quote: 'The CRM integration assistance was extremely smooth. The support specialists hopped on a video call and finished Zoho setup for us within 30 minutes.' },
              { avatar: 'VG', name: 'Vikram Gupta', role: 'Marketing VP, HealthSync Clinics', quote: 'Meta approval took less than 4 hours. We were broadcasting our festive campaigns to 10k subscribers on the same afternoon. Brilliant onboarding speed!' },
              { avatar: 'NS', name: 'Nisha Sen', role: 'Customer Support Dir, FlyWorld Travels', quote: 'The unified team inbox is fantastic. Our 15 support agents handle 500+ chats concurrently on the same number without dropping replies or overriding.' },
              { avatar: 'AD', name: 'Aditya Das', role: 'Product Manager, InsureFast Solutions', quote: 'We switched from a global competitor to SOFT7 and cut our monthly bill by 40% while getting much faster support responses in Indian timezones.' }
            ].map((testi, i) => {
              const isExpanded = !!expandedTesti[i];
              const shouldTruncate = isMobile && testi.quote.length > 90;
              const displayQuote = shouldTruncate && !isExpanded ? `${testi.quote.substring(0, 85)}...` : testi.quote;

              return (
                <motion.div 
                  key={i} 
                  className={styles.testiCard}
                  variants={fadeInUp}
                  whileHover={isMobile ? {} : { y: -6, boxShadow: '0 10px 25px rgba(0, 0, 0, 0.05)' }}
                >
                  <div className={styles.testiCardContent}>
                    <div className={styles.rating}>
                      <FaStar /><FaStar /><FaStar /><FaStar /><FaStar />
                    </div>
                    <p className={styles.testiQuote}>
                      "{displayQuote}"
                      {shouldTruncate && (
                        <button 
                          className={styles.readMoreBtn} 
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedTesti(prev => ({ ...prev, [i]: !prev[i] }));
                          }}
                        >
                          {isExpanded ? ' Read Less' : ' Read More'}
                        </button>
                      )}
                    </p>
                  </div>
                  <div className={styles.clientMeta}>
                    <div className={styles.clientAvatar}>{testi.avatar}</div>
                    <div className={styles.clientInfo}>
                      <h4>{testi.name}</h4>
                      <p>{testi.role}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* SECTION 8 - Glowing Best-Value Pricing Overview (With 3D Parallax Tilt) */}
      <section className={styles.pricingSection}>
        <div className={styles.container}>
          <motion.div 
            className={styles.sectionHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
          >
            <h2>Affordable, Scale-Friendly Pricing Plans</h2>
            <p>Pay-as-you-grow with zero setup costs. Select the package that fits your messaging requirements.</p>
          </motion.div>
          <motion.div 
            className={styles.pricingGrid}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
          >
            {/* Starter */}
            <TiltCard className={styles.priceCard}>
              <div className={styles.priceHeader}>
                <h3>Starter</h3>
                <p>For Small Businesses starting with WhatsApp API.</p>
                <div className={styles.priceValue}>
                  <span className={styles.priceNum}>₹999</span>
                  <span className={styles.pricePeriod}>/mo (or ₹7,999/yr)</span>
                </div>
              </div>
              <ul className={styles.priceFeatures}>
                <li><FaCheckCircle className={styles.priceCheck} /> 5 Active Team Agents</li>
                <li><FaCheckCircle className={styles.priceCheck} /> Unlimited Broadcast Lists</li>
                <li><FaCheckCircle className={styles.priceCheck} /> No-Code Chatbot Builder</li>
                <li><FaCheckCircle className={styles.priceCheck} /> Zoho & HubSpot Integrations</li>
                <li><FaCheckCircle className={styles.priceCheck} /> Dedicated Email Support</li>
              </ul>
              <Link to="/pricing" className={styles.btnSecondary} style={{ textDecoration: 'none' }}>
                View Full Pricing
              </Link>
            </TiltCard>

            {/* Growth - Glowing border active card */}
            <TiltCard className={styles.priceCard + ' ' + styles.priceCardPopular}>
              <div className={styles.popularBadge}>Best Value</div>
              <div className={styles.priceHeader}>
                <h3>Growth</h3>
                <p>For growing companies scaling customer support.</p>
                <div className={styles.priceValue}>
                  <span className={styles.priceNum}>₹2,999</span>
                  <span className={styles.pricePeriod}>/mo</span>
                </div>
              </div>
              <ul className={styles.priceFeatures}>
                <li><FaCheckCircle className={styles.priceCheck} /> 15 Active Team Agents</li>
                <li><FaCheckCircle className={styles.priceCheck} /> Advanced Multi-Agent Routing</li>
                <li><FaCheckCircle className={styles.priceCheck} /> Full Chatbot & API Webhooks</li>
                <li><FaCheckCircle className={styles.priceCheck} /> 10+ Pre-built CRM Plugins</li>
                <li><FaCheckCircle className={styles.priceCheck} /> 24/7 Priority WhatsApp Support</li>
              </ul>
              <Link to="/pricing" className={styles.btnPrimary} style={{ textDecoration: 'none' }}>
                View Full Pricing
              </Link>
            </TiltCard>

            {/* Enterprise */}
            <TiltCard className={styles.priceCard}>
              <div className={styles.priceHeader}>
                <h3>Enterprise</h3>
                <p>For large-scale messaging requirements.</p>
                <div className={styles.priceValue}>
                  <span className={styles.priceNum}>Custom</span>
                </div>
              </div>
              <ul className={styles.priceFeatures}>
                <li><FaCheckCircle className={styles.priceCheck} /> Unlimited Team Agents</li>
                <li><FaCheckCircle className={styles.priceCheck} /> Dedicated Server Instances</li>
                <li><FaCheckCircle className={styles.priceCheck} /> Custom CRM / ERP Integrations</li>
                <li><FaCheckCircle className={styles.priceCheck} /> Custom Bot Logic (Python/JS)</li>
                <li><FaCheckCircle className={styles.priceCheck} /> Dedicated Key Account Manager</li>
              </ul>
              <button className={styles.btnSecondary} onClick={() => {
                const element = document.getElementById('lead-capture-form');
                element?.scrollIntoView({ behavior: 'smooth' });
              }}>
                Get Custom Quote
              </button>
            </TiltCard>
          </motion.div>
        </div>
      </section>

      {/* SECTION 9 - Frequently Asked Questions */}
      <section className={styles.faqSection}>
        <div className={styles.container}>
          <motion.div 
            className={styles.sectionHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
          >
            <h2>Frequently Asked Questions</h2>
            <p>Everything you need to know about the official API, setup process, and pricing rules.</p>
          </motion.div>
          <div className={styles.faqList}>
            {[
              { q: 'Is this official WhatsApp Business API?', a: 'Yes, SOFT7 provides official Meta Cloud WhatsApp Business API integration. This guarantees that your business complies with Meta\'s Guidelines, protecting your number from bans and enabling official green tick verify status.' },
              { q: 'How long does setup take?', a: 'Onboarding is fast. Once you provide the Meta Business Manager details and valid phone number, we get display names and configuration approved under 24 hours (often in under 4 hours).' },
              { q: 'What are Meta conversation charges?', a: 'Meta charges per 24-hour conversation window based on category (Utility, Marketing, Authentication, Service). The first 1,00,000 service conversations every month are 100% free of Meta fees.' },
              { q: 'Can I send bulk messages?', a: 'Yes! You can broadcast templates, product updates, and coupon offers to unlimited opt-in users. Our system implements smart queue routing to optimize delivery speed.' },
              { q: 'Can I connect my CRM?', a: 'Yes, absolutely. We support native, one-click integration plugins for Zoho CRM, HubSpot, Leadsquared, Salesforce, Shopify, and Webhooks for custom database synchronizations.' },
              { q: 'Is support included?', a: 'Yes, support is included in all subscription tiers. Growth and Enterprise plans receive priority 24/7 dedicated support via WhatsApp and phone calls.' },
              { q: 'Is the setup really free?', a: 'Yes! There are no onboarding, setup, or hidden configuration fees. We waive the developer setup charges of ₹4,999 to help you start your campaigns stress-free.' },
              { q: 'What is included in the RCS panel?', a: 'Our unified dashboard includes a free RCS Messaging panel, which allows you to send rich cards, video brochures, and interactive action buttons to Android users, with detailed receipt reports.' }
            ].map((faq, index) => (
              <motion.div
                key={index}
                className={styles.faqItem + ' ' + (openFaq === index ? styles.faqItemOpen : '')}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.05 }}
              >
                <button className={styles.faqQuestion} onClick={() => toggleFaq(index)}>
                  {faq.q} <FaChevronDown className={styles.faqToggleIcon} />
                </button>
                <AnimatePresence initial={false}>
                  {openFaq === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeInOut' }}
                      style={{ overflow: 'hidden', borderTop: '1px solid #f1f5f9', backgroundColor: '#fafbfc' }}
                    >
                      <div style={{ padding: '1.5rem', fontSize: '0.975rem', color: '#475569', lineHeight: 1.6 }}>
                        {faq.a}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 10 - Glassmorphic Lead Capture Section */}
      <section className={styles.leadCaptureSection} id="lead-capture-form">
        <div className={styles.container}>
          <div className={styles.captureGrid}>
            <motion.div 
              className={styles.captureContent}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={slideInLeft}
            >
              <h2>Get Your Free WhatsApp API Setup Today</h2>
              <p>Skip the setup hassle. Register details below to lock in our zero-cost integration assistance worth ₹4,999 + free RCS panel.</p>
              
              {/* Option 3: Glowing 3D Compliance Shield */}
              <div className={styles.securityShieldWrapper}>
                <img src="/security_shield_3d.png" className={styles.securityShield3d} alt="Meta Compliance Shield" />
              </div>

              <div className={styles.bulletList}>
                <div className={styles.bulletItem}>
                  <FaCheckCircle className={styles.bulletIcon} /> 100% Free Developer Onboarding Support
                </div>
                <div className={styles.bulletItem}>
                  <FaCheckCircle className={styles.bulletIcon} /> Pre-built CRM Sync Integrations
                </div>
                <div className={styles.bulletItem}>
                  <FaCheckCircle className={styles.bulletIcon} /> Unified Multi-Agent Team Inbox Panel
                </div>
              </div>
            </motion.div>

            <motion.div 
              className={styles.formBox}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={slideInRight}
            >
              <h3>Claim Setup Reward</h3>
              {!bottomFormSubmitted ? (
                <form className={styles.form} onSubmit={(e) => handleFormSubmit(e, 'bottom')}>
                  <div className={styles.formGroup}>
                    <label>Full Name</label>
                    <input
                      type="text"
                      required
                      placeholder="John Doe"
                      value={bottomForm.name}
                      onChange={(e) => setBottomForm({ ...bottomForm, name: e.target.value })}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>WhatsApp Contact Number</label>
                    <input
                      type="tel"
                      required
                      placeholder="+91 86054 90132"
                      value={bottomForm.phone}
                      onChange={(e) => setBottomForm({ ...bottomForm, phone: e.target.value })}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Company Name</label>
                    <input
                      type="text"
                      required
                      placeholder="Company Private Limited"
                      value={bottomForm.company}
                      onChange={(e) => setBottomForm({ ...bottomForm, company: e.target.value })}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Monthly Message Requirement</label>
                    <select
                      value={bottomForm.volume}
                      onChange={(e) => setBottomForm({ ...bottomForm, volume: e.target.value })}
                    >
                      <option value="10k-50k">10,000 - 50,000 messages</option>
                      <option value="50k-200k">50,000 - 2,00,000 messages</option>
                      <option value="200k+">More than 2,00,000 messages</option>
                    </select>
                  </div>
                  {formErrors.bottom && (
                    <p role="alert" className={styles.formNote} style={{ color: '#b91c1c' }}>
                      {formErrors.bottom}
                    </p>
                  )}
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit" 
                    className={styles.btnPrimary + ' ' + styles.formBtn}
                    onClick={(e) => handleFormSubmit(e, 'bottom')}
                    disabled={submittingForm !== null}
                    aria-busy={submittingForm === 'bottom'}
                  >
                    {submittingForm === 'bottom' ? 'Submitting...' : (
                      <>
                        🚀 Get Free WhatsApp API Setup
                      </>
                    )}
                  </motion.button>
                  <p className={styles.formNote}>Free Setup Worth ₹4,999 Included.</p>
                </form>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={styles.formSuccessState}
                >
                  <FaCheckCircle className={styles.successIcon} />
                  <h4>Setup Package Activated!</h4>
                  <p>A technical onboarding manager will call you shortly to configure your brand number.</p>
                </motion.div>
              )}
            </motion.div>
          </div>
        </div>
      </section>

      {/* SECTION 11 - Final CTA */}
      <section className={styles.finalCtaSection}>
        <div className={styles.container}>
          <motion.div 
            className={styles.ctaContent}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
          >
            <h2>Ready to Grow with Official WhatsApp Business API?</h2>
            <p>Start with Free Setup, Free RCS Panel, Fast Approval, and Dedicated Support.</p>
            <div className={styles.ctaActions}>
              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={styles.btnPrimary} 
                onClick={() => window.location.href = "/demo#book-demo-form"}
              >
                Book Free Demo
              </motion.button>
              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={styles.btnSecondary} 
                onClick={() => {
                  const element = document.getElementById('lead-capture-form');
                  element?.scrollIntoView({ behavior: 'smooth' });
                }} 
                style={{ color: '#0f172a' }}
              >
                Talk To Expert
              </motion.button>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
