import ScrollContainer from '@/components/ScrollContainer';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

import Hero from '@/components/sections/Hero';
import WhatIsIt from '@/components/sections/WhatIsIt';
import Purpose from '@/components/sections/Purpose';
import Easier from '@/components/sections/Easier';
import Integrate from '@/components/sections/Integrate';
import Messengers from '@/components/sections/Messengers';
import Benefits from '@/components/sections/Benefits';
import Headache from '@/components/sections/Headache';
import ProblemsWeSolve from '@/components/sections/ProblemsWeSolve';
import RoadmapSection from '@/components/sections/RoadmapSection';
import Faq from '@/components/sections/Faq';

import { PURPOSE_ITEMS } from '@/data/content';

/**
 * Section order is the template's, `home-1` through `home-11`. The two
 * `home-3` panels are the same component with different content.
 */
export default function Home() {
  return (
    <ScrollContainer>
      <div data-page="">
        <main>
          <Navbar />

          <Hero />
          <WhatIsIt />
          <Purpose
            title="Purpose of using"
            titleAccent="Ghost Writer"
            items={PURPOSE_ITEMS}
            activated
          />
          <Easier />
          <Integrate />
          <Messengers />
          <Benefits />
          <Headache />
          <ProblemsWeSolve />
          <RoadmapSection />
          <Faq />
        </main>

        <Footer />
      </div>
    </ScrollContainer>
  );
}
