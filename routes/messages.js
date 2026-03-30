var express = require("express");
var router = express.Router();
const Message = require("../schemas/messages");          // schemas/ ngang cấp routes/
const { verifyToken } = require("../utils/authHandler.js"); // utils/ ngang cấp routes/
const { uploadAny } = require("../utils/uploadHandler.js"); // utils/ ngang cấp routes/

/**
 * GET /api/v1/messages/:userID
 * Lấy toàn bộ tin nhắn 2 chiều giữa user hiện tại và :userID
 */
router.get("/:userID", verifyToken, async (req, res) => {
    try {
        const currentUserId = req.user._id;
        const { userID } = req.params;

        const messages = await Message.find({
            $or: [
                { from: currentUserId, to: userID },
                { from: userID, to: currentUserId },
            ],
        })
            .populate("from", "name email avatar")
            .populate("to", "name email avatar")
            .sort({ createdAt: 1 });

        return res.status(200).json({
            success: true,
            data: messages,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/v1/messages
 * Gửi tin nhắn mới
 * Body (form-data):
 *   - to   : userID người nhận       (bắt buộc)
 *   - text : nội dung                (bắt buộc nếu không có file)
 *   - file : file đính kèm           (nếu có → type = "file")
 */
router.post("/", verifyToken, uploadAny.single("file"), async (req, res) => {
    try {
        const currentUserId = req.user._id;
        const { to, text } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                message: "Thiếu thông tin người nhận (to)",
            });
        }

        let messageContent;

        if (req.file) {
            messageContent = {
                type: "file",
                text: req.file.path,
            };
        } else if (text && text.trim() !== "") {
            messageContent = {
                type: "text",
                text: text.trim(),
            };
        } else {
            return res.status(400).json({
                success: false,
                message: "Nội dung tin nhắn không được để trống",
            });
        }

        const newMessage = await Message.create({
            from: currentUserId,
            to,
            messageContent,
        });

        const populated = await newMessage.populate([
            { path: "from", select: "name email avatar" },
            { path: "to", select: "name email avatar" },
        ]);

        return res.status(201).json({
            success: true,
            data: populated,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/v1/messages
 * Lấy tin nhắn cuối cùng của mỗi cuộc hội thoại mà user hiện tại tham gia
 */
router.get("/", verifyToken, async (req, res) => {
    try {
        const currentUserId = req.user._id;

        const lastMessages = await Message.aggregate([
            {
                $match: {
                    $or: [{ from: currentUserId }, { to: currentUserId }],
                },
            },
            {
                $addFields: {
                    partner: {
                        $cond: {
                            if: { $eq: ["$from", currentUserId] },
                            then: "$to",
                            else: "$from",
                        },
                    },
                },
            },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: "$partner",
                    lastMessage: { $first: "$$ROOT" },
                },
            },
            { $replaceRoot: { newRoot: "$lastMessage" } },
            { $sort: { createdAt: -1 } },
        ]);

        const populated = await Message.populate(lastMessages, [
            { path: "from", select: "name email avatar" },
            { path: "to", select: "name email avatar" },
        ]);

        return res.status(200).json({
            success: true,
            data: populated,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;