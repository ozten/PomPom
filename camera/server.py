"""
ArUco marker detection server using OpenCV.
Provides API endpoint for detecting markers in uploaded images.
"""

import io
import base64
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


app = FastAPI(title="PomPom Camera Server")

# Allow CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Point(BaseModel):
    x: float
    y: float


class DetectedMarker(BaseModel):
    id: int
    corners: list[Point]  # TL, TR, BR, BL


class DetectionResult(BaseModel):
    markers: list[DetectedMarker]
    image_width: int
    image_height: int
    error: Optional[str] = None


class HomographyRequest(BaseModel):
    camera_points: list[Point]
    projector_points: list[Point]


class HomographyResult(BaseModel):
    matrix: list[list[float]]
    success: bool
    error: Optional[str] = None


# ArUco detector setup (using 4x4_50 dictionary)
aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
aruco_params = cv2.aruco.DetectorParameters()
aruco_detector = cv2.aruco.ArucoDetector(aruco_dict, aruco_params)


@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "ok", "opencv_version": cv2.__version__}


@app.post("/detect", response_model=DetectionResult)
async def detect_markers(image: UploadFile = File(...)):
    """
    Detect ArUco markers in an uploaded image.

    Accepts: image file (JPEG, PNG, etc.)
    Returns: list of detected markers with their corner coordinates
    """
    try:
        # Read image data
        contents = await image.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image file")

        height, width = img.shape[:2]

        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Detect markers
        corners, ids, rejected = aruco_detector.detectMarkers(gray)

        markers = []
        if ids is not None:
            for i, marker_id in enumerate(ids.flatten()):
                # corners[i][0] is shape (4, 2) - four corners, each with x,y
                corner_points = corners[i][0]
                markers.append(DetectedMarker(
                    id=int(marker_id),
                    corners=[
                        Point(x=float(corner_points[0][0]), y=float(corner_points[0][1])),  # TL
                        Point(x=float(corner_points[1][0]), y=float(corner_points[1][1])),  # TR
                        Point(x=float(corner_points[2][0]), y=float(corner_points[2][1])),  # BR
                        Point(x=float(corner_points[3][0]), y=float(corner_points[3][1])),  # BL
                    ]
                ))

        return DetectionResult(
            markers=markers,
            image_width=width,
            image_height=height
        )

    except Exception as e:
        return DetectionResult(
            markers=[],
            image_width=0,
            image_height=0,
            error=str(e)
        )


@app.post("/detect-base64", response_model=DetectionResult)
async def detect_markers_base64(data: dict):
    """
    Detect ArUco markers from a base64-encoded image.

    Accepts: {"image": "base64-encoded-image-data"}
    Returns: list of detected markers with their corner coordinates
    """
    try:
        image_data = data.get("image", "")

        # Remove data URL prefix if present
        if "," in image_data:
            image_data = image_data.split(",")[1]

        # Decode base64
        img_bytes = base64.b64decode(image_data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image data")

        height, width = img.shape[:2]

        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Detect markers
        corners, ids, rejected = aruco_detector.detectMarkers(gray)

        markers = []
        if ids is not None:
            for i, marker_id in enumerate(ids.flatten()):
                corner_points = corners[i][0]
                markers.append(DetectedMarker(
                    id=int(marker_id),
                    corners=[
                        Point(x=float(corner_points[0][0]), y=float(corner_points[0][1])),
                        Point(x=float(corner_points[1][0]), y=float(corner_points[1][1])),
                        Point(x=float(corner_points[2][0]), y=float(corner_points[2][1])),
                        Point(x=float(corner_points[3][0]), y=float(corner_points[3][1])),
                    ]
                ))

        return DetectionResult(
            markers=markers,
            image_width=width,
            image_height=height
        )

    except Exception as e:
        return DetectionResult(
            markers=[],
            image_width=0,
            image_height=0,
            error=str(e)
        )


@app.post("/homography", response_model=HomographyResult)
async def calculate_homography(request: HomographyRequest):
    """
    Calculate homography matrix from camera points to projector points.

    Requires at least 4 point correspondences.
    """
    try:
        if len(request.camera_points) < 4:
            return HomographyResult(
                matrix=[],
                success=False,
                error="Need at least 4 point correspondences"
            )

        if len(request.camera_points) != len(request.projector_points):
            return HomographyResult(
                matrix=[],
                success=False,
                error="Camera and projector point counts must match"
            )

        # Convert to numpy arrays
        src_pts = np.array([[p.x, p.y] for p in request.camera_points], dtype=np.float32)
        dst_pts = np.array([[p.x, p.y] for p in request.projector_points], dtype=np.float32)

        # Calculate homography using RANSAC
        H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC)

        if H is None:
            return HomographyResult(
                matrix=[],
                success=False,
                error="Failed to compute homography"
            )

        # Convert to nested list
        matrix = H.tolist()

        return HomographyResult(
            matrix=matrix,
            success=True
        )

    except Exception as e:
        return HomographyResult(
            matrix=[],
            success=False,
            error=str(e)
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
