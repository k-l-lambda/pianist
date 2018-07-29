
import cv2 as cv
import numpy as np
import tensorflow as tf



double_map_threshold = 100

sess = tf.InteractiveSession()


def panCompare(source, pan):
    width, height = source.shape[1] - abs(pan[1]), source.shape[0] - abs(pan[0])
    result = np.zeros((height, width), np.uint8)

    xs = (-pan[1], 0)[pan[1] > 0]
    ys = (-pan[0], 0)[pan[0] > 0]

    for x in range(xs, xs + width):
        for y in range(ys, ys + height):
            result[y - ys, x - xs] = 255 - abs(int(source[y, x]) - int(source[y + pan[0], x + pan[1]]))

    return result


def panCompareTf(source, pan, pad):
    v_source = tf.cast(source, tf.int32)
    v_source_pad = tf.pad(v_source, pad)

    v_source_pan = tf.map_fn(lambda p: tf.pad(v_source, [[pad[0][0] + p[0], pad[0][1] - p[0]], [pad[1][0] + p[1], pad[1][1] - p[1]]]), np.array(pan))

    v_255 = tf.constant(255)

    sub = tf.subtract(v_255, tf.abs(tf.subtract(v_source_pad, v_source_pan)))
    v_result = tf.slice(sub, [0, pad[0][0], pad[1][0]], [-1, source.shape[0], source.shape[1]])

    return v_result


def grayScale(img):
    s = 0
    for y in range(img.shape[0]):
        s += sum(img[y])

    return s / (img.shape[0] * img.shape[1])


def panMap(source, start, end):
    result = np.zeros((end[0] - start[0], end[1] - start[1]), np.uint8)
    
    for x in range(start[1], end[1]):
        for y in range(start[0], end[0]):
            p = panCompare(source, (y, x))
            result[y - start[0], x - start[1]] = int(grayScale(p))

    return result


def panMapTf(source, start, end):
    yf = max(0, -min(start[0], end[0]))
    yt = max(0, max(start[0], end[0]))
    xf = max(0, -min(start[1], end[1]))
    xt = max(0, max(start[1], end[1]))

    pad = [[yf, yt], [xf, xt]]
    
    #v_source = tf.placeholder(tf.uint8, [end[0] - start[0], end[1] - start[1]])
    pan = [[int(y), int(x)] for y in range(start[0], end[0]) for x in range(start[1], end[1])]
    #c_pan = np.array(pan)
    
    pc = panCompareTf(source, pan, pad)
    mean = tf.reduce_mean(pc, [1, 2])
    pm = tf.reshape(mean, [end[0] - start[0], end[1] - start[1]])

    result = pm.eval()

    return result


def doubleCompare(img, y, x, x1, x2):
    d1 = 255 - abs(int(img[y, x]) - int(img[y, x1]))
    d2 = 255 - abs(int(img[y, x]) - int(img[y, x2]))

    return d1 - d2


def verticalLine(image):
    line = np.zeros((image.shape[0], 1), np.uint8)
    for y in range(image.shape[0]):
        line[y, 0] = np.mean(image[y])

    return line


def doubleMap(img, left, right, d1, d2, top = None, bottom = None):
    result = np.zeros((img.shape[0], right - left), np.uint8)

    if top is None:
        top = 0
    if bottom is None:
        bottom = img.shape[0]

    for y in range(img.shape[0]):
        for x in range(left, right):
            if y >= top and y < bottom:
                result[y, x - left] = abs(doubleCompare(img, y, x, x - d1, x - d2))
            else:
                result[y, x - left] = 0
        
    return result


def findFocusRange(img, left, right, d1, d2, top = None, bottom = None):
    dm = doubleMap(img, left, right, d1, d2, top, bottom)
    line = verticalLine(dm)

    indices = []
    for y in range(dm.shape[0]):
        if line[y, 0] > double_map_threshold:
            indices.append(y)

    center_y = np.mean(indices) / dm.shape[0]
    length = len(indices) / dm.shape[0]

    return center_y, length
    

def slideCompare(source, target, size, start, end):
    target = cv.resize(target, size)

    result = []

    for y in range(start[0], end[0]):
        for x in range(start[1], end[1]):
            tp = (y - start[0], x - start[1])

            differ = 0
            for py in range(size[1]):
                for px in range(size[0]):
                    differ += abs(int(source[y + py, x + px]) - int(target[py, px]))

            result.append(differ / (size[0] * size[1]))

    return result
    
