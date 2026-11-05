// User-facing copy. Plain words only — no technical jargon.

// Friendly date for save times. Today and yesterday get names,
// older days get a short date like "Mar 4, 5:00 PM".
export const formatFriendlyDate = (timestamp: number | null): string | null => {
  if (timestamp == null) return null;
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const now = new Date();
  const isSameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (isSameDay(date, now)) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
};

export const copy = {
  auth: {
    signInTitle: "Welcome back",
    signInSubtitle: "Sign in to keep your tasks in sync.",
    signUpTitle: "Create your account",
    signUpSubtitle: "A few details and you are in.",
    emailLabel: "Email address",
    passwordLabel: "Password",
    confirmPasswordLabel: "Confirm password",
    forgotPassword: "Forgot your password?",
    signInButton: "Sign in",
    signUpButton: "Create account",
    switchToSignUp: "New here? Create an account",
    switchToSignIn: "Already have an account? Sign in",
    invalidCredentials: "That email or password does not match.",
    emailInUse: "An account with that email already exists.",
    weakPassword: "Please choose a stronger password.",
    signingIn: "Signing you in...",
    creatingAccount: "Creating your account...",
    // invite
    inviteCodeLabel: "Invite code",
    inviteCodeHint: "Ask the person who invited you.",
    inviteValid: "Looks good.",
    inviteInvalid: "That code is not valid.",
    inviteChecking: "Checking...",
    // check email
    checkEmailTitle: "Check your email",
    checkEmailSubtitle: "We sent a link to",
    openMail: "Open your email",
    resend: "Send again",
    resendCooldown: "Send again in",
    wrongEmail: "Wrong email? Change it",
    didntGetIt: "Did not get it? Check spam, or send again.",
    // forgot/reset
    forgotTitle: "Forgot your password?",
    forgotSubtitle: "Enter your email and we will send a link.",
    sendLink: "Send me a link",
    forgotConfirm: "If that email exists, we sent a link.",
    resetTitle: "Set a new password",
    resetExpired: "This link has expired. Send me a new one.",
    resetSuccess: "Password updated. Sign in again.",
    // verify email
    verifyTitle: "Email verified",
    verifySubtitle: "Redirecting you now.",
    // two factor
    twoFactorTitle: "Extra security check",
    twoFactorSubtitle: "Enter the 6-digit code from your app.",
    useEmergency: "Use an emergency code instead",
    rememberDevice: "Remember this device for 30 days",
    verifyButton: "Verify",
    // sign in extras
    magicLink: "Email me a sign-in link",
    google: "Google",
    apple: "Apple",
    capsLock: "Caps Lock is on",
  },
  onboarding: {
    welcomeTitle: "Let's set up your space",
    welcomeSubtitle: "A quick tour so Todo Studio fits how you work.",
    stepProfile: "Your profile",
    stepPreferences: "Your preferences",
    stepDone: "All set",
    displayNameLabel: "What should we call you?",
    timezoneLabel: "Your time zone",
    weekStartsLabel: "Week starts on",
    themeLabel: "Look and feel",
    defaultListLabel: "Open this list first",
    continueButton: "Continue",
    finishButton: "Finish setup",
    skipButton: "Skip for now",
  },
  account: {
    title: "Account settings",
    profileSection: "Profile",
    preferencesSection: "Preferences",
    securitySection: "Security",
    nameLabel: "Display name",
    emailLabel: "Email address",
    timezoneLabel: "Time zone",
    localeLabel: "Language",
    themeLabel: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeAuto: "Match system",
    saveButton: "Save changes",
    saving: "Saving...",
    saved: "Changes saved.",
    dangerZone: "Danger zone",
    deleteAccount: "Delete account",
    deleteConfirm: "This cannot be undone. Type your email to confirm.",
  },
  // Task words used across lists, Groups, and Trash.
  tasks: {
    group: "Group",
    moveToTrash: "Move to Trash",
    restoreFromTrash: "Restore",
    archiveNote: "Hidden for now",
    templateSentence: "Save it as a reusable task.",
    bulkSelect: "Select several",
    subtask: "Sub-task",
    subtaskDepthLimit: "Sub-tasks can only go 3 levels deep.",
    duplicateVerb: "Make a copy",
    restoredToInbox: "Its list was deleted, so we put it in your Inbox.",
    completeWithSubtasks: (n: number): string =>
      n === 1 ? "Also complete the sub-task?" : `Also complete the ${n} sub-tasks?`,
    deleteListConfirm: (name: string): string =>
      `"${name}" is now in Trash. You can bring it back.`,
  },
  // Save status wording. Short lines a young reader can follow.
  sync: {
    allSaved: "All changes saved",
    saving: "Saving…",
    savingCount: (n: number): string =>
      n === 1 ? "Saving 1 change…" : `Saving ${n} changes…`,
    offlineBanner:
      "You're offline. Changes stay on this device and will send when you're back.",
    backOnline: "Back online. Catching up…",
    settingUp: "Getting things ready…",
    refreshing: "Getting the latest changes…",
    stuck: "Having trouble saving. We'll keep trying.",
    waitingCount: (n: number): string =>
      n === 1 ? "1 change waiting" : `${n} changes waiting`,
    conflictKept: (name: string): string => `Kept your copy of "${name}".`,
    deletedElsewhere: "Removed on another device.",
    rejectedReverted: "One change didn't work, so we put it back.",
    updatedFromDevice: (deviceName: string): string =>
      `Updated from ${deviceName}.`,
    showNewVersion: "See what's new",
    keepMine: "Keep mine",
    saveNow: "Save now",
    title: "Save details",
    close: "Close",
    lastUpdated: (ts: number | null): string | null => {
      const friendly = formatFriendlyDate(ts);
      return friendly === null ? null : `Last updated ${friendly}`;
    },
  },
} as const;

export type Copy = typeof copy;