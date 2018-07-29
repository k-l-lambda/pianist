
import math
import time

from pan_map import *



keyboard_wave_indices = [0, 20, 39, 58, 72, 87.5, 108, 127, 145.5, 166.5, 181, 195.5, 216, 234.5, 255]
keyboard_wave_mask = [0, 0, 0, 0, 0, -1, 2, -4, 4, -2, 1, -0.1, 0.1, -1, 4]

double_map_threshold = 144

keyboard_height_proportion = 1.54


def sigmoid(x):
	return (1 - math.exp(-x)) / (1 + math.exp(-x));

	
def measureKeyboradWave(img, point):
	global keyboard_wave_indices

	start_y = int(img.shape[0] / 2)

	scale = keyboard_wave_indices[len(keyboard_wave_indices) - 1]

	points = [img[min(round(point[0] * (x / scale) + start_y), img.shape[0] - 1), min(round(point[1] * (x / scale)), img.shape[1] - 1)] for x in keyboard_wave_indices]

	result = 0

	l = []
	for i in range(5, len(points)):
		differ = int(points[i]) - int(points[i - 1])

		result += sigmoid(differ * keyboard_wave_mask[i] / 10)

		l.append(differ)

	return result, l


def measureMap(img):
	result = np.zeros((img.shape[0] * 4, img.shape[1] * 4), np.uint8)
	
	for x in range(img.shape[1] * 4):
		for y in range(int(-img.shape[0] * 2), int(img.shape[0] * 2)):
				value, l = measureKeyboradWave(img, (y * 0.25, x * 0.25))
				result[y, x] = max(int(value * 27), 0)

	return result


def maxIndex(values):
	return values.index(max(values))


def minIndex(values):
	return values.index(min(values))


def location(snapshot, pm = None):
	time0 = time.time()

	shape = snapshot.shape
	
	#threshold = cv.cvtColor(snapshot, cv.COLOR_BGR2GRAY)
	threshold = cv.medianBlur(snapshot, 5)
	threshold = cv.adaptiveThreshold(threshold, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 41, 10)

	time1 = time.time()
	#print("duration.1:", time1 - time0)

	thumb = threshold
	while thumb.shape[1] > 600:
		thumb = cv.pyrDown(thumb)

	pyr_factor = shape[0] / thumb.shape[0]

	pan_shape = (int(round(thumb.shape[1] * 0.006)), int(thumb.shape[1] * 0.2))

	time2 = time.time()
	#print("duration.2:", time2 - time1)

	panmap = None
	if pm is not None:
		panmap = pm
	else:
		#panmap = panMap(thumb, (-pan_shape[0], 0), (pan_shape[0], pan_shape[1]))
		panmap = panMapTf(thumb, (-pan_shape[0], 0), (pan_shape[0], pan_shape[1]))

	time3 = time.time()
	#print("duration.3:", time3 - time2)

	# keyboard wave measure
	wave_line = []
	for x in np.arange(pan_shape[1] * 0.5, pan_shape[1], 0.25):
		values = []
		for y in range(-pan_shape[0], pan_shape[0]):
			value, l = measureKeyboradWave(panmap, (y, float(x)))
			values.append(value)
		wave_line.append(np.mean(values))
	cycle_x = shape[1] * 0.1 + maxIndex(wave_line) * pyr_factor / 4

	time4 = time.time()
	#print("duration.4:", time4 - time3)

	thumb_cx = int(cycle_x / pyr_factor)

	test_position = keyboard_wave_indices[len(keyboard_wave_indices) - 2] / keyboard_wave_indices[len(keyboard_wave_indices) - 1]
	test_distance = int(thumb_cx * test_position)

	time5 = time.time()
	#print("duration.5:", time5 - time4)

	left = int(thumb.shape[1] / 2)
	bk_center_y, bk_length = findFocusRange(thumb, left, left + thumb_cx, thumb_cx, test_distance)

	top = int((bk_center_y - (bk_length / 2 + 0.03)) * thumb.shape[0])
	bottom = int((bk_center_y + (bk_length / 2 + 0.03)) * thumb.shape[0])


	# find left range, right range, calculate theta
	left_pos, right_pos = int(thumb.shape[1] * 0.1), int(thumb.shape[1] * 0.9)
	left_cy, left_length = findFocusRange(thumb, left_pos + thumb_cx, left_pos + thumb_cx * 2, thumb_cx, test_distance, top, bottom)
	right_cy, right_length = findFocusRange(thumb, right_pos - thumb_cx, right_pos, thumb_cx, test_distance, top, bottom)

	time6 = time.time()
	#print("duration.6:", time6 - time5)

	#print(left_pos, left_pos + thumb_cx, thumb_cx, test_distance, top, bottom)

	#print(shape[0] * (left_cy - left_length / 2), shape[0] * (left_cy + left_length / 2), (left_pos + thumb_cx) * 4)
	#print(shape[0] * (bk_center_y - bk_length / 2), shape[0] * (bk_center_y + bk_length / 2), left * 4)
	#print(shape[0] * (right_cy - right_length / 2), shape[0] * (right_cy + right_length / 2), (right_pos - thumb_cx) * 4)


	# correct thumb rotation
	tan_left = (bk_center_y - left_cy) * thumb.shape[0] / (left - (left_pos + thumb_cx))
	tan_right = (right_cy - bk_center_y) * thumb.shape[0] / ((right_pos - thumb_cx) - left)
	angle = math.atan((tan_left + tan_right) / 2) * 180 / math.pi
	rotate_mat = cv.getRotationMatrix2D((left, bk_center_y * thumb.shape[0]), angle, 1)

	straighten_thumb = cv.warpAffine(thumb, rotate_mat, (thumb.shape[1], thumb.shape[0]))

	time7 = time.time()
	#print("duration.7:", time7 - time6)


	# horizontal slide find offset x
	cos_angle = math.cos(angle * math.pi / 180)
	cycle_width = int((cycle_x / cos_angle) / pyr_factor)
	group_height = int(thumb.shape[0] * bk_length / cos_angle)
	group_size = (cycle_width, group_height)
	key_group = cv.imread(r'data/keyboard_group.png', 0)
	left = int(thumb.shape[1] / 2 - cycle_width)
	right = left + cycle_width
	top = int(thumb.shape[0] * (bk_center_y - bk_length / 2))
	horizontal_slide = slideCompare(straighten_thumb, key_group, group_size, (top, left), (top + 1, right))
	center_x = (left + minIndex(horizontal_slide) + cycle_width / 2) * pyr_factor

	center_y = shape[0] * bk_center_y
	top_y = center_y - shape[0] * (bk_length / 2) / cos_angle
	height = shape[0] * bk_length * keyboard_height_proportion / cos_angle
	bottom_y = top_y + height

	group_width = cycle_x / cos_angle
	half_width = group_width * (26 / 7)
	left_x = center_x - half_width
	right_x = center_x + half_width

	time8 = time.time()
	#print("duration.8:", time8 - time7)

	print("duration.total:", time8 - time0)


	# TODO: find trapezoid scale

	# TODO: find accurate position in full scale snapshot

	return thumb, panmap, wave_line, group_width, angle, center_x, center_y, (left_x, right_x, top_y, bottom_y)


def locateAndMark(snapshot, pm = None):
	thumb, panmap, wave_line, group_width, angle, center_x, center_y, rect = location(snapshot, pm)

	result = cv.cvtColor(snapshot, cv.COLOR_GRAY2RGB)

	rotate_mat = cv.getRotationMatrix2D((center_x, center_y), angle, 1)
	result = cv.warpAffine(result, rotate_mat, (snapshot.shape[1], snapshot.shape[0]))

	left, right, top, bottom = rect
	left = int(round(left))
	right = int(round(right))
	top = int(round(top))
	bottom = int(round(bottom))

	# draw rectangle
	result = cv.line(result, (left, top), (right, top), (0, 255, 0), 4)
	result = cv.line(result, (left, bottom), (right, bottom), (0, 255, 0), 4)
	result = cv.line(result, (left, top), (left, bottom), (0, 255, 0), 4)
	result = cv.line(result, (right, top), (right, bottom), (0, 255, 0), 4)

	x = center_x - group_width * 24 / 7
	for i in range(7):
		ix = int(round(x))
		result = cv.line(result, (ix, top), (ix, bottom), (0, 255, 0), 3)
		x += group_width

	#inv_rotate_mat = cv.getRotationMatrix2D((center_x, center_y), -angle, 1)
	#result = cv.warpAffine(result, rotate_mat, (snapshot.shape[1], snapshot.shape[0]))

	return result


def markVideo(input_filename, ouput_filename):
	infile = cv.VideoCapture(input_filename)

	fourcc = cv.VideoWriter_fourcc(*'XVID')
	out = cv.VideoWriter(ouput_filename, fourcc, infile.get(cv.CAP_PROP_FPS), (int(infile.get(cv.CAP_PROP_FRAME_WIDTH)), int(infile.get(cv.CAP_PROP_FRAME_HEIGHT))))

	i = 0

	while(infile.isOpened()):
		ret, frame = infile.read()
		if ret:
			frame = cv.cvtColor(frame, cv.COLOR_BGR2GRAY)

			mark = locateAndMark(frame)
			out.write(mark)

			i += 1
			print("frames:", i)
		else:
			break

	infile.release()
	out.release()

