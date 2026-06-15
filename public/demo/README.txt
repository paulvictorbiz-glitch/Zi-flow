Reel DNA — landing page sample media
====================================

The public landing-page demo (src/lib/reel-dna-demo.jsx → sampleReel)
references two files that live in THIS folder and are served from the
site root under /demo/:

  1. sample-reel.mp4
     - A short VERTICAL 9:16 clip, roughly 10-28 seconds long.
     - The demo timeline is built for a 0:28 reel (DEMO_REEL.totalSec = 28),
       so a clip around 28s lines up best with the scrubber/ruler. Anything
       in the 10-28s range works fine for the proof-of-concept.
     - Keep it small (web-optimized H.264 MP4, ideally < 5 MB) so the page
       loads fast. Encode at 1080x1920 (or 720x1280) if you can.

  2. sample-reel-poster.jpg
     - A single poster / thumbnail frame for the video (shown before play
       and while loading). Same 9:16 aspect ratio as the clip.
     - A JPG around 1080x1920 is ideal.

Until these files are dropped in, the paths /demo/sample-reel.mp4 and
/demo/sample-reel-poster.jpg will 404. The reel-player component handles
this gracefully (it shows an upload affordance instead of the video), so
the landing page still renders correctly without them.

Where to source royalty-free vertical clips (free, commercial-use OK —
always double-check the per-asset license):

  - Pexels Videos   https://www.pexels.com/videos/   (filter Orientation: Portrait)
  - Pixabay         https://pixabay.com/videos/       (free, no attribution req.)
  - Mixkit          https://mixkit.co/free-stock-video/  (free Mixkit license)
  - Coverr          https://coverr.co/

Suggested workflow:
  1. Download a vertical clip from one of the above.
  2. Trim/encode to ~10-28s, 9:16, H.264 MP4 (e.g. with ffmpeg or CapCut).
  3. Export one frame as the poster JPG.
  4. Save them here as exactly:
       sample-reel.mp4
       sample-reel-poster.jpg

Example ffmpeg one-liners (optional):
  # trim first 28s, scale to 1080x1920, web-optimize
  ffmpeg -i input.mp4 -t 28 -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -c:v libx264 -movflags +faststart -pix_fmt yuv420p sample-reel.mp4
  # grab a poster frame at 1 second
  ffmpeg -i sample-reel.mp4 -ss 00:00:01 -frames:v 1 sample-reel-poster.jpg
