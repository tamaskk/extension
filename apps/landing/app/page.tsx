import Navbar from '@/components/Navbar';
import StatsProvider from '@/components/StatsProvider';
import Hero from '@/components/Hero';
import LogoStrip from '@/components/LogoStrip';
import StatsSection from '@/components/StatsSection';
import Features from '@/components/Features';
import Testimonials from '@/components/Testimonials';
import BuildSection from '@/components/BuildSection';
import Faq from '@/components/Faq';
import Footer from '@/components/Footer';

export default function Page() {
  return (
    <StatsProvider>
      <div className="glow" aria-hidden />
      <Navbar />
      <main className="shell">
        <Hero />
        <LogoStrip />
        <StatsSection />
        <Features />
        <Testimonials />
        <BuildSection />
        <Faq />
      </main>
      <Footer />
    </StatsProvider>
  );
}
