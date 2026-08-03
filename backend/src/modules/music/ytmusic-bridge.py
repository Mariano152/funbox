import json
import os
import random
import sys
import time

import requests
from ytmusicapi import YTMusic

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

class TimeoutSession(requests.Session):
    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", 12)
        return super().request(method, url, **kwargs)


ytmusic = YTMusic(requests_session=TimeoutSession())
delay_min = float(os.environ.get("YTMUSIC_DELAY_MIN", "0.6"))
delay_max = float(os.environ.get("YTMUSIC_DELAY_MAX", "0.9"))


def compact_result(item):
    return {
        "videoId": item.get("videoId"),
        "title": item.get("title") or "",
        "artists": [artist.get("name", "") for artist in item.get("artists", [])],
        "durationSeconds": item.get("duration_seconds"),
        "resultType": item.get("resultType"),
        "videoType": item.get("videoType"),
        "views": item.get("views"),
    }


for line in sys.stdin:
    try:
        request = json.loads(line)
        if request.get("action") == "chart_tracks":
            charts = ytmusic.get_charts(country=request.get("country", "ZZ"))
            results = []
            playlists = charts.get("videos", [])
            preferred = [item for item in playlists if "Top 100" in item.get("title", "")]
            for playlist in (preferred or playlists[:1]):
                playlist_id = playlist.get("playlistId")
                if playlist_id:
                    results.extend(ytmusic.get_playlist(playlist_id, limit=100).get("tracks", []))
        elif request.get("action") == "video_metadata":
            video_id = request.get("videoId")
            playlist = ytmusic.get_watch_playlist(videoId=video_id, limit=1)
            results = [item for item in playlist.get("tracks", []) if item.get("videoId") == video_id][:1]
        else:
            query = f'{request["title"]} {request["artist"]}'
            search_filter = request.get("searchFilter", "songs")
            if search_filter == "all":
                search_filter = None
            results = ytmusic.search(query, filter=search_filter, limit=8)
        payload = {
            "requestId": request["requestId"],
            "results": [compact_result(item) for item in results if item.get("videoId")],
        }
    except Exception as error:
        payload = {
            "requestId": request.get("requestId") if "request" in locals() else None,
            "error": str(error),
        }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    # Primera pasada rápida: los fallos se reintentan globalmente al final,
    # no bloquean este trabajador durante varios segundos.
    time.sleep(delay_min + random.random() * max(0.0, delay_max - delay_min))
