import { useCallback, useEffect, useRef, useState } from 'react';

export type SageState = 'idle' | 'happy' | 'thinking' | 'speaking' | 'error' | 'waiting';

const MESSAGE_POOLS: Record<SageState, string[]> = {
  idle: [
    // Professional
    'Ready to assist.',
    'How can I help you today?',
    'Standing by.',
    'Awaiting your query.',
    'Prepared to help.',
    'At your service.',
    'Ready when you are.',
    'Feel free to ask me anything.',
    'Awaiting your input.',
    'Standing ready.',
    // Playful
    "Ask me anything.",
    "I'm here.",
    "What's on your mind?",
    'Need help with something?',
    'Ready and waiting!',
    'Here for you.',
    "Let's chat!",
    'What would you like to know?',
    'Your wish is my command.',
    'Ready for action!',
  ],
  happy: [
    // Professional
    'Welcome back. How may I assist you?',
    'Good to see you again.',
    'Hello again. How can I help?',
    'Welcome back. What shall we work on today?',
    'Glad you returned.',
    'Welcome back. Ready to continue.',
    'Good to see you. What would you like to explore?',
    'Hello! How may I be of service?',
    // Playful
    'Welcome back, friend!',
    'Good to see you again!',
    "You're back! Let's explore!",
    'Yay, you\'re here!',
    'Hey! Great to see you!',
    "You're back! Ready for more?",
    'Woohoo! Back for more!',
    'Hi there, friend!',
    "Hey! Let's do this!",
    'Welcome back! Ready to chat?',
    "The more the merrier! Let's go!",
  ],
  thinking: [
    // Professional
    'Processing your request...',
    'Analyzing...',
    'Working through this...',
    'Examining the details...',
    'Computing...',
    'Reviewing...',
    'Calculating...',
    'Evaluating...',
    'Processing...',
    'Investigating...',
    // Playful
    "Hmm, let me think...",
    'Working on it...',
    "Let me look into that...",
    'Crunching numbers...',
    'Wrangling some ideas...',
    'Untangling this...',
    'Piecing it together...',
    'Racking my brain...',
    'Connecting the dots...',
    'Turning it over...',
  ],
  speaking: [
    // Professional
    "Here's what I found...",
    'In short...',
    'So the answer is...',
    "Here's the deal...",
    'To summarize...',
    'The key points are...',
    'Let me explain...',
    "Here's the information...",
    'In summary...',
    'The bottom line is...',
    // Playful
    "Here's the scoop!",
    'So basically...',
    'The gist is...',
    "Guess what I found?",
    'Lightbulb moment!',
    'Oh, interesting!',
    "You won't believe this...",
    'Drumroll please...',
    'The moment you\'ve been waiting for...',
    'And there it is!',
  ],
  error: [
    // Professional
    'Apologies, let me try that again.',
    'I encountered an error. Retrying...',
    'Something went wrong. Let me try again.',
    'My apologies. This requires another attempt.',
    'An error occurred. Attempting recovery.',
    'Let me start that over.',
    "That's not quite right. Let me retry.",
    'I need to try again. One moment.',
    'Apologies for the inconvenience.',
    'Let me correct that.',
    // Playful
    'Oopsie daisy! Let me try that again.',
    "Whoopsie! That's on me.",
    ' Ruh roh! That didn\'t work.',
    'My bad! Let me fix that.',
    'Plot twist: I messed up!',
    'Well, that didn\'t work...',
    'Cardboard failed! Retrying...',
    'Blorp! Something went wrong.',
    'Oof, let me try that again!',
    'Well this is awkward... retrying!',
  ],
  waiting: [
    // Professional
    'Give me a moment...',
    'Just a sec...',
    'Hold on...',
    'Please wait...',
    'One moment please...',
    'Still working...',
    'Composing response...',
    'Processing your request...',
    'Working on it...',
    'Almost there...',
    // Playful
    'Be right with you!',
    'Hold your horses!',
    'Just a hot sec!',
    'Almost there!',
    'On it!',
    'Cooking with gas now!',
    'Patience, young grasshopper!',
    'The Sage is brewing...',
    'Great things take time!',
    'Pondering...',
  ],
};

const STORAGE_KEY_VISITED = 'sage_has_visited';
const STORAGE_KEY_LAST_ACTIVE = 'sage_last_active';
const RETURN_THRESHOLD_MS = 30_000;

function getRandomMessage(state: SageState): string {
  const pool = MESSAGE_POOLS[state];
  return pool[Math.floor(Math.random() * pool.length)];
}

export function useSageState() {
  const [sageState, setSageState] = useState<SageState>('idle');
  const [sageMessage, setSageMessage] = useState<string>(getRandomMessage('idle'));
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstVisitRef = useRef<boolean>(false);

  const clearErrorTimeout = useCallback(() => {
    if (errorTimeoutRef.current !== null) {
      clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = null;
    }
  }, []);

  const clearSpeakTimeout = useCallback(() => {
    if (speakTimeoutRef.current !== null) {
      clearTimeout(speakTimeoutRef.current);
      speakTimeoutRef.current = null;
    }
  }, []);

  const transitionTo = useCallback((newState: SageState) => {
    clearErrorTimeout();
    clearSpeakTimeout();
    setSageState(newState);
    setSageMessage(getRandomMessage(newState));

    if (newState === 'error') {
      errorTimeoutRef.current = setTimeout(() => {
        setSageState('idle');
        setSageMessage(getRandomMessage('idle'));
      }, 5000);
    }

    if (newState === 'happy') {
      sessionStorage.setItem(STORAGE_KEY_LAST_ACTIVE, Date.now().toString());
    }
  }, [clearErrorTimeout, clearSpeakTimeout]);

  const startStreaming = useCallback(() => {
    clearErrorTimeout();
    clearSpeakTimeout();
    transitionTo('thinking');
    speakTimeoutRef.current = setTimeout(() => {
      setSageState((prev) => {
        if (prev === 'thinking') {
          setSageMessage(getRandomMessage('speaking'));
          return 'speaking';
        }
        return prev;
      });
    }, 1500);
  }, [transitionTo, clearErrorTimeout, clearSpeakTimeout]);

  const stopStreaming = useCallback(() => {
    clearErrorTimeout();
    clearSpeakTimeout();
    setSageState('idle');
    setSageMessage(getRandomMessage('idle'));
    sessionStorage.setItem(STORAGE_KEY_LAST_ACTIVE, Date.now().toString());
  }, [clearErrorTimeout, clearSpeakTimeout]);

  const onStreamError = useCallback(() => {
    transitionTo('error');
  }, [transitionTo]);

  const onFirstVisit = useCallback(() => {
    sessionStorage.setItem(STORAGE_KEY_VISITED, '1');
    sessionStorage.setItem(STORAGE_KEY_LAST_ACTIVE, Date.now().toString());
    transitionTo('happy');
  }, [transitionTo]);

  useEffect(() => {
    const hasVisited = sessionStorage.getItem(STORAGE_KEY_VISITED);
    isFirstVisitRef.current = !hasVisited;

    if (!hasVisited) {
      onFirstVisit();
    } else {
      setSageMessage(getRandomMessage('idle'));
    }
  }, [onFirstVisit]);

  useEffect(() => {
    const handleFocus = () => {
      const lastActive = sessionStorage.getItem(STORAGE_KEY_LAST_ACTIVE);
      if (lastActive) {
        const elapsed = Date.now() - parseInt(lastActive, 10);
        if (elapsed >= RETURN_THRESHOLD_MS) {
          transitionTo('happy');
        }
      }
    };

    const handleBlur = () => {
      sessionStorage.setItem(STORAGE_KEY_LAST_ACTIVE, Date.now().toString());
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      clearErrorTimeout();
    };
  }, [transitionTo, clearErrorTimeout]);

  return {
    sageState,
    sageMessage,
    startStreaming,
    stopStreaming,
    onStreamError,
    onFirstVisit,
  };
}