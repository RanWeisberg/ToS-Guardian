/** @type {import('next').NextConfig} */
const nextConfig = {
  // The healthcheck + future core routes use Node-only SDKs (openai, pinecone,
  // supabase); nothing here should be pushed onto the Edge runtime.
  reactStrictMode: true,
};

export default nextConfig;