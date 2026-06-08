import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
const logo = '/sikka-logo.svg';

const Splash = () => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isLoading) {
        sessionStorage.setItem('splashShown', '1');
        navigate(user ? '/' : '/auth', { replace: true });
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [isLoading, user, navigate]);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background overflow-hidden">
      <motion.div
        initial={{ scale: 0.82, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="flex flex-col items-center gap-8"
      >
        <motion.img
          src={logo}
          alt="Sikka"
          className="w-52 h-52 object-contain sm:h-56 sm:w-56"
          initial={{ y: 20 }}
          animate={{ y: 0 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 200, damping: 18 }}
        />
      </motion.div>
    </div>
  );
};

export default Splash;
