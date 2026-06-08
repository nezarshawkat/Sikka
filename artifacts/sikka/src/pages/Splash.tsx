import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
import logo from '@assets/Group_1_1780314663182.png';

const Splash = () => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isLoading) {
        sessionStorage.setItem('splashShown', '1');
        navigate(user ? '/' : '/auth', { replace: true });
      }
    }, 2800);
    return () => clearTimeout(timer);
  }, [isLoading, user, navigate]);

  useEffect(() => {
    if (!isLoading && user) {
      sessionStorage.setItem('splashShown', '1');
      navigate('/', { replace: true });
    }
  }, [isLoading, user, navigate]);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#CC0000] overflow-hidden">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18, duration: 0.6 }}
        className="flex flex-col items-center gap-8"
      >
        <motion.img
          src={logo}
          alt="Sikka"
          className="w-52 h-52 object-contain drop-shadow-2xl"
          initial={{ y: 20 }}
          animate={{ y: 0 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 200, damping: 18 }}
        />
      </motion.div>

      <motion.div
        className="absolute bottom-16 flex gap-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="h-2 w-2 rounded-full bg-white/60"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </motion.div>
    </div>
  );
};

export default Splash;
