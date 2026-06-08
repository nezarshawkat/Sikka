import { SignIn } from '@clerk/react';
import { shadcn } from '@clerk/themes';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const appearance = {
  baseTheme: shadcn,
  variables: {
    colorPrimary: '#3b82f6',
    colorForeground: '#161b27',
    colorMutedForeground: '#6b7280',
    colorDanger: '#ef4444',
    colorBackground: '#f8fafc',
    colorInput: '#e2e8f0',
    colorInputForeground: '#161b27',
    colorNeutral: '#e2e8f0',
    fontFamily: "'DM Sans', 'Cairo', sans-serif",
    borderRadius: '0.5rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white dark:bg-gray-900 rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-gray-900 font-bold',
    headerSubtitle: 'text-gray-500',
    socialButtonsBlockButtonText: 'text-gray-700',
    formFieldLabel: 'text-gray-700 font-medium',
    footerActionLink: 'text-blue-600 font-semibold',
    footerActionText: 'text-gray-500',
    dividerText: 'text-gray-400',
    identityPreviewEditButton: 'text-blue-600',
    formFieldSuccessText: 'text-green-600',
    alertText: 'text-gray-700',
    logoBox: 'flex justify-center mb-2',
    logoImage: 'h-10 w-auto',
    socialButtonsBlockButton: 'border border-gray-200 hover:border-blue-400',
    formButtonPrimary: 'bg-blue-500 hover:bg-blue-600 text-white font-semibold',
    formFieldInput: 'border-gray-300 bg-white text-gray-900',
    footerAction: 'text-center',
    dividerLine: 'border-gray-200',
    alert: 'rounded-lg',
    otpCodeFieldInput: 'border-gray-300 text-gray-900',
    formFieldRow: '',
    main: '',
  },
};

const SignInPage = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
    <div className="mb-8 text-center">
      <img
        src={`${import.meta.env.BASE_URL}sikka-logo.svg`}
        alt="Sikka"
        className="h-20 w-auto mx-auto"
      />
      <p className="text-sm text-muted-foreground mt-3">Your intelligent transport companion in Egypt</p>
    </div>
    <SignIn
      routing="path"
      path={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      fallbackRedirectUrl={`${basePath}/`}
      appearance={appearance}
      localization={{
        signIn: {
          start: {
            title: 'Welcome back',
            subtitle: 'Sign in to plan your journey',
          },
        },
      }}
    />
  </div>
);

export default SignInPage;
