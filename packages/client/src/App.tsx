import './styles/globals.css';
import AppRouter from './router.js';
import { ToastContainer } from './components/ui/ToastContainer.js';

export default function App() {
  return (
    <>
      <AppRouter />
      <ToastContainer />
    </>
  );
}