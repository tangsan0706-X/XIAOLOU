import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import ScriptPlaza from "./pages/ScriptPlaza";
import ApiCenter from "./pages/ApiCenter";
import ComicShell from "./pages/comic/ComicShell";
import GlobalSettings from "./pages/comic/GlobalSettings";
import StoryScript from "./pages/comic/StoryScript";
import Entities from "./pages/comic/Entities";
import Storyboard from "./pages/comic/Storyboard";
import Video from "./pages/comic/Video";
import Dubbing from "./pages/comic/Dubbing";
import Preview from "./pages/comic/Preview";
import ImageCreate from "./pages/create/ImageCreate";
import VideoCreate from "./pages/create/VideoCreate";
import Assets from "./pages/Assets";
import WalletRecharge from "./pages/WalletRecharge";
import EnterpriseConsole from "./pages/EnterpriseConsole";

// Placeholder components for other routes
const Placeholder = ({ title }: { title: string }) => (
  <div className="flex-1 flex items-center justify-center text-muted-foreground">
    <h2 className="text-2xl font-medium">{title}</h2>
  </div>
);

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="home" element={<Home />} />
          <Route path="enterprise" element={<EnterpriseConsole />} />
          <Route path="wallet/recharge" element={<WalletRecharge />} />
          <Route path="script-plaza" element={<ScriptPlaza />} />
          
          <Route path="create">
            <Route path="image" element={<ImageCreate />} />
            <Route path="video" element={<VideoCreate />} />
          </Route>

          <Route path="comic" element={<ComicShell />}>
            <Route path="global" element={<GlobalSettings />} />
            <Route path="script" element={<StoryScript />} />
            <Route path="entities" element={<Entities />} />
            <Route path="storyboard" element={<Storyboard />} />
            <Route path="video" element={<Video />} />
            <Route path="dubbing" element={<Dubbing />} />
            <Route path="preview" element={<Preview />} />
          </Route>

          <Route path="assets" element={<Assets />} />
          <Route path="tutorial" element={<Placeholder title="教程" />} />
          <Route path="api-center" element={<ApiCenter />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
