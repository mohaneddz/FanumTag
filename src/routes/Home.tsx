import { useNavigate } from "@solidjs/router";
import { open } from '@tauri-apps/plugin-dialog';

import HomeCard from "@/components/HomeCard";

export default function Home() {
  const navigate = useNavigate();

  const goToAbout = () => {
    navigate("/about");
  }

  const goToSettings = () => {
    navigate("/settings");
  }

  const goToPreview = async () => {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Select Folder",
    });

    if (typeof selected === 'string') {
      // navigate("/", { replace: true });
      setTimeout(() => {
        console.log(`Selected folder: ${selected}`);
        navigate(`/preview?folder=${encodeURIComponent(selected)}`);
      }, 0);
    }
  }

  return (
    <main>
      <HomeCard
        goToAbout={goToAbout}
        goToSettings={goToSettings}
        goToPreview={goToPreview}
      />
    </main>
  );
};